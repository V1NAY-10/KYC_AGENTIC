import { chat } from './llm.service.js';
import { ageFromDob, todayLabel } from '../../utils/age.js';

// ─── Rule Thresholds ──────────────────────────────────────────────────────────
const RULES = {
  MIN_MONTHLY_INCOME:      15000,   // ₹ — below this → reject
  MAX_LOAN_TO_INCOME_RATIO: 24,     // loanAmount ÷ monthlyIncome
  MAX_EMI_BURDEN_RATIO:    0.50,    // existingEMI ÷ monthlyIncome
  MIN_EMPLOYMENT_MONTHS:   6,       // employmentYears in months equivalent
  MIN_CONFIDENCE:          0.75,    // fields below this trigger manual review
};

/**
 * Run deterministic rule checks.
 * @returns {{ flags: object, hardReject: boolean, manualReview: boolean }}
 */
function runRules(fields, fraudSignals = []) {
  const get = (key) => {
    const f = fields.find(f => f.key === key);
    return f ? { value: parseFloat(f.finalValue ?? f.aiExtractedValue), confidence: f.confidence, flagged: f.isFlagged } : null;
  };

  const flags = {};
  let hardReject = false;
  let manualReview = false;
  const reasons = [];
  const conditions = [];

  // 0. Age — computed here, never by the LLM (it doesn't know today's date)
  const dobField = fields.find(f => f.key === 'dateOfBirth');
  const age = ageFromDob(dobField?.finalValue ?? dobField?.aiExtractedValue);
  if (age !== null) {
    flags.applicantAge = age;
    if (age < 18) {
      hardReject = true;
      reasons.push(`Applicant is ${age} years old — below the minimum age of 18.`);
    } else if (age > 65) {
      manualReview = true;
      reasons.push(`Applicant is ${age} years old — loan tenure may extend past retirement age.`);
    }
  }

  // 1. Income check
  const income = get('monthlyIncome');
  if (!income || isNaN(income.value)) {
    flags.incomeNotProvided = true;
    manualReview = true;
    reasons.push('Monthly income could not be verified from the interview.');
  } else if (income.value < RULES.MIN_MONTHLY_INCOME) {
    flags.incomeTooLow = true;
    hardReject = true;
    reasons.push(`Monthly income ₹${income.value.toLocaleString()} is below the minimum requirement of ₹${RULES.MIN_MONTHLY_INCOME.toLocaleString()}.`);
  }

  // 2. Loan-to-income ratio
  const loanAmount = get('loanAmount');
  if (income?.value && loanAmount?.value && !isNaN(loanAmount.value)) {
    const ratio = loanAmount.value / income.value;
    flags.loanToIncomeRatio = ratio.toFixed(2);
    if (ratio > RULES.MAX_LOAN_TO_INCOME_RATIO) {
      hardReject = true;
      reasons.push(`Requested loan amount ₹${loanAmount.value.toLocaleString()} is ${ratio.toFixed(1)}× monthly income — exceeds the ${RULES.MAX_LOAN_TO_INCOME_RATIO}× limit.`);
    }
  }

  // 3. EMI burden
  const existingEMI = get('existingEMI');
  if (income?.value && existingEMI?.value && !isNaN(existingEMI.value)) {
    const emiBurden = existingEMI.value / income.value;
    flags.emiBurdenRatio = emiBurden.toFixed(2);
    if (emiBurden > RULES.MAX_EMI_BURDEN_RATIO) {
      manualReview = true;
      conditions.push(`Existing EMI burden is ${(emiBurden * 100).toFixed(0)}% of income — consider debt consolidation or reduced loan amount.`);
      reasons.push(`High existing EMI obligations (${(emiBurden * 100).toFixed(0)}% of income).`);
    }
  }

  // 4. Employment tenure
  const employmentYears = get('employmentYears');
  if (employmentYears?.value && !isNaN(employmentYears.value)) {
    const months = employmentYears.value >= 10
      ? employmentYears.value          // assume months if huge
      : employmentYears.value * 12;    // convert years
    const roundedMonths = Math.max(1, Math.round(months));
    flags.employmentMonths = roundedMonths;
    if (months < RULES.MIN_EMPLOYMENT_MONTHS) {
      manualReview = true;
      reasons.push(`Employment tenure is only about ${roundedMonths} month${roundedMonths === 1 ? '' : 's'} — below the ${RULES.MIN_EMPLOYMENT_MONTHS}-month minimum.`);
      conditions.push('Provide additional income proof (bank statements for last 6 months).');
    }
  }

  // 5. Low-confidence fields
  const lowConfidenceFields = fields.filter(f => f.confidence < RULES.MIN_CONFIDENCE && f.aiExtractedValue);
  if (lowConfidenceFields.length > 0) {
    flags.lowConfidenceFields = lowConfidenceFields.map(f => f.key);
    manualReview = true;
    reasons.push(`Fields with low extraction confidence: ${lowConfidenceFields.map(f => f.label || f.key).join(', ')}.`);
  }

  // 6. Fraud signals — these are heuristic/LLM-raised, so they route to a human
  //    officer instead of auto-rejecting a possibly genuine applicant
  const highFraud = (fraudSignals || []).filter(s => s.severity === 'high');
  if (highFraud.length > 0) {
    flags.fraudSignals = highFraud.map(s => s.type);
    manualReview = true;
    reasons.push(`High-severity fraud signal(s) detected: ${highFraud.map(s => s.description || s.type).join('; ')}.`);
  }

  return { flags, hardReject, manualReview, reasons, conditions };
}

/**
 * LLM holistic assessment of the applicant's profile.
 */
async function llmAssessment(fields, ruleResult, language) {
  const profile = fields.reduce((acc, f) => {
    acc[f.key] = f.finalValue ?? f.aiExtractedValue;
    return acc;
  }, {});

  const systemPrompt = `You are a senior personal loan credit officer at an Indian bank.
You have received the following applicant profile from a KYC video interview.

TODAY'S DATE: ${todayLabel()}
APPLICANT AGE: ${ruleResult.flags.applicantAge ?? 'unknown'} years (computed from date of birth — use this value, do not recalculate)

APPLICANT PROFILE:
${JSON.stringify(profile, null, 2)}

RULE ENGINE FLAGS:
${JSON.stringify(ruleResult.flags, null, 2)}

ISSUES ALREADY REPORTED BY THE RULE ENGINE (do NOT repeat or rephrase these in keyRisks):
${ruleResult.reasons.map(r => `- ${r}`).join('\n') || '- none'}

Perform a holistic credit assessment. Consider:
- Income stability vs loan size
- Employment history
- Loan purpose (productive vs. consumptive)
- Declared EMI burden vs. income
- Any unusual patterns

Return ONLY valid JSON:
{
  "creditScore": 0-100,
  "recommendation": "approved" | "conditional" | "manual_review",
  "keyStrengths": ["..."],
  "keyRisks": ["..."],
  "additionalConditions": ["..."],
  "summary": "One sentence officer summary"
}

keyStrengths: list genuine positives (e.g. no existing EMIs, income comfortably above the minimum); use [] only if there are none.
Be factual — only reference values present in the profile.`;

  try {
    return await chat({ systemPrompt, userMessage: 'Assess this applicant.', json: true, lane: 'secondary' });
  } catch (err) {
    console.error('[LoanEngine] LLM assessment failed:', err.message);
    return {
      creditScore: 50,
      recommendation: 'manual_review',
      keyStrengths: [],
      keyRisks: ['LLM assessment unavailable — manual review required.'],
      additionalConditions: [],
      summary: 'Automated assessment could not complete. Manual review required.',
    };
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────
/**
 * Evaluate a personal loan application.
 * @param {Array}  fields       - KYC fields array from extraction.service
 * @param {Array}  fraudSignals - Fraud signals from session
 * @param {string} language     - 'en' | 'hi'
 * @returns {Promise<object>}   - Final loan decision object
 */
export async function evaluateLoan(fields, fraudSignals, language = 'en') {
  const ruleResult = runRules(fields, fraudSignals);

  // Hard reject — no point calling LLM
  if (ruleResult.hardReject) {
    return {
      decision: 'rejected',
      score: 0,
      reasons: ruleResult.reasons,
      conditions: [],
      ruleFlags: ruleResult.flags,
      llmAssessment: null,
      decidedAt: new Date(),
    };
  }

  // Run LLM assessment
  const llm = await llmAssessment(fields, ruleResult, language);

  // Merge decisions — rules take precedence for manual_review
  let finalDecision = ['approved', 'conditional', 'manual_review'].includes(llm.recommendation)
    ? llm.recommendation
    : 'manual_review';
  if (ruleResult.flags.fraudSignals) {
    finalDecision = 'manual_review';
  } else if (ruleResult.manualReview && finalDecision === 'approved') {
    finalDecision = 'conditional';
  }

  const allReasons = [
    ...ruleResult.reasons,
    ...(llm.keyRisks || []),
  ];

  const allConditions = [
    ...ruleResult.conditions,
    ...(llm.additionalConditions || []),
  ];

  return {
    decision: finalDecision,
    score: llm.creditScore ?? 50,
    reasons: allReasons,
    conditions: allConditions,
    ruleFlags: ruleResult.flags,
    llmAssessment: {
      strengths: llm.keyStrengths || [],
      risks: llm.keyRisks || [],
      summary: llm.summary || '',
    },
    decidedAt: new Date(),
  };
}
