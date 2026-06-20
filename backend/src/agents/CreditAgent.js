import { BaseAgent } from './base/BaseAgent.js';

/**
 * CreditAgent
 *
 * Credit assessment with two modes:
 *   1. quickAssess() — Mid-call lightweight check (no LLM). Flags obvious problems early.
 *   2. run()         — Full evaluation after all fields collected:
 *                      Rules engine → EMI calculation → LLM holistic assessment → merge
 *
 * Replaces loanEngine.service.js with a proper agent interface.
 *
 * Input:  { fields (array or object), fraudSignals, language, sessionId }
 * Output: { decision, score, reasons, conditions, ruleFlags, emiProjection, llmAssessment, decidedAt }
 */
export class CreditAgent extends BaseAgent {
  constructor() {
    super('CreditAgent');
  }

  // ── Full evaluation ──────────────────────────────────────────────────────────
  async run({ fields, fraudSignals = [], language = 'en', sessionId }) {
    const thresholds = this.semanticMemory.getCreditThresholds();

    // Step 1: Rule-based checks (deterministic, fast)
    const ruleResult = this._runRules(fields, fraudSignals, thresholds);

    // Hard reject → skip LLM (save tokens + latency)
    if (ruleResult.hardReject) {
      this.log('info', 'Hard reject — skipping LLM assessment', { sessionId, reasons: ruleResult.reasons });
      return {
        decision:      'rejected',
        score:         0,
        reasons:       ruleResult.reasons,
        conditions:    [],
        ruleFlags:     ruleResult.flags,
        emiProjection: null,
        llmAssessment: null,
        decidedAt:     new Date(),
      };
    }

    // Step 2: EMI projection (tool call)
    let emiData = null;
    try {
      const loanAmount = this._getField(fields, 'loanAmount');
      const loanTenure = this._getField(fields, 'loanTenure');
      if (loanAmount && loanTenure) {
        emiData = await this.useTool('calculate_emi', {
          principal: loanAmount, annualRatePercent: 12, tenureMonths: loanTenure,
        }, sessionId);
      }
    } catch (e) {
      this.log('warn', 'EMI calculation failed', { sessionId, error: e.message });
    }

    // Step 3: LLM holistic assessment
    const llmResult = await this._llmAssessment(fields, ruleResult, emiData, language);

    // Step 4: Merge — rules override LLM where applicable
    let finalDecision = llmResult.recommendation;
    if (ruleResult.manualReview && finalDecision === 'approved') {
      finalDecision = 'conditional';
    }

    this.log('info', 'Credit decision made', { sessionId, decision: finalDecision, score: llmResult.creditScore });

    return {
      decision:      finalDecision,
      score:         llmResult.creditScore ?? 50,
      reasons:       [...ruleResult.reasons,   ...(llmResult.keyRisks            || [])],
      conditions:    [...ruleResult.conditions, ...(llmResult.additionalConditions || [])],
      ruleFlags:     ruleResult.flags,
      emiProjection: emiData,
      llmAssessment: {
        strengths: llmResult.keyStrengths || [],
        risks:     llmResult.keyRisks     || [],
        summary:   llmResult.summary      || '',
      },
      decidedAt: new Date(),
    };
  }

  // ── Quick mid-call assessment (no LLM) ──────────────────────────────────────
  quickAssess(collectedFields = {}) {
    const thresholds = this.semanticMemory.getCreditThresholds();
    const earlyFlags = [];

    const income     = parseFloat(collectedFields.monthlyIncome);
    const loanAmount = parseFloat(collectedFields.loanAmount);

    if (!isNaN(income) && income < thresholds.minMonthlyIncome) {
      earlyFlags.push({
        type: 'LOW_INCOME', severity: 'high',
        message: `Income ₹${income.toLocaleString()} is below minimum ₹${thresholds.minMonthlyIncome.toLocaleString()}`,
      });
    }

    if (!isNaN(income) && !isNaN(loanAmount) && income > 0) {
      const ratio = loanAmount / income;
      if (ratio > thresholds.maxLoanToIncomeRatio) {
        earlyFlags.push({
          type: 'HIGH_LTI_RATIO', severity: 'medium',
          message: `Loan-to-income ratio ${ratio.toFixed(1)}× exceeds ${thresholds.maxLoanToIncomeRatio}× limit`,
        });
      }
    }

    return { earlyFlags, hasIssues: earlyFlags.length > 0 };
  }

  // ── Private: rule engine ─────────────────────────────────────────────────────
  _runRules(fields, fraudSignals, thresholds) {
    const get = (key) => {
      if (Array.isArray(fields)) {
        const f = fields.find(f => f.key === key);
        return f ? { value: parseFloat(f.finalValue ?? f.aiExtractedValue), confidence: f.confidence || 1 } : null;
      }
      return fields[key] !== undefined ? { value: parseFloat(fields[key]), confidence: 1 } : null;
    };

    const flags = {};
    let hardReject = false, manualReview = false;
    const reasons = [], conditions = [];

    // Income
    const income = get('monthlyIncome');
    if (!income || isNaN(income.value)) {
      flags.incomeNotProvided = true; manualReview = true;
      reasons.push('Monthly income could not be verified from the interview.');
    } else if (income.value < thresholds.minMonthlyIncome) {
      flags.incomeTooLow = true; hardReject = true;
      reasons.push(`Income ₹${income.value.toLocaleString()} below minimum ₹${thresholds.minMonthlyIncome.toLocaleString()}.`);
    }

    // LTI ratio
    const loanAmount = get('loanAmount');
    if (income?.value && loanAmount?.value && !isNaN(loanAmount.value)) {
      const ratio = loanAmount.value / income.value;
      flags.loanToIncomeRatio = ratio.toFixed(2);
      if (ratio > thresholds.maxLoanToIncomeRatio) {
        hardReject = true;
        reasons.push(`Loan ₹${loanAmount.value.toLocaleString()} is ${ratio.toFixed(1)}× income — exceeds ${thresholds.maxLoanToIncomeRatio}× limit.`);
      }
    }

    // EMI burden
    const existingEMI = get('existingEMI');
    if (income?.value && existingEMI?.value && !isNaN(existingEMI.value)) {
      const burden = existingEMI.value / income.value;
      flags.emiBurdenRatio = burden.toFixed(2);
      if (burden > thresholds.maxEMIBurdenRatio) {
        manualReview = true;
        reasons.push(`EMI burden ${(burden * 100).toFixed(0)}% of income exceeds ${thresholds.maxEMIBurdenRatio * 100}% limit.`);
        conditions.push('Consider debt consolidation or reduced loan amount.');
      }
    }

    // Employment tenure
    const empYears = get('employmentYears');
    if (empYears?.value && !isNaN(empYears.value)) {
      const months = empYears.value >= 10 ? empYears.value : empYears.value * 12;
      flags.employmentMonths = months;
      if (months < thresholds.minEmploymentMonths) {
        manualReview = true;
        reasons.push(`Employment ${months} month(s) below ${thresholds.minEmploymentMonths} month minimum.`);
        conditions.push('Provide 6-month bank statements as additional income proof.');
      }
    }

    // High fraud signals → hard reject
    const highFraud = (fraudSignals || []).filter(s => s.severity === 'high');
    if (highFraud.length > 0) {
      flags.highFraudSignals = highFraud.map(s => s.type);
      hardReject = true;
      reasons.push(`High-severity fraud signal(s): ${highFraud.map(s => s.type).join(', ')}.`);
    }

    return { flags, hardReject, manualReview, reasons, conditions };
  }

  // ── Private: LLM holistic assessment ────────────────────────────────────────
  async _llmAssessment(fields, ruleResult, emiData, language) {
    const profile = Array.isArray(fields)
      ? fields.reduce((acc, f) => { acc[f.key] = f.finalValue ?? f.aiExtractedValue; return acc; }, {})
      : { ...fields };

    const systemPrompt = `You are a senior personal loan credit officer at an Indian bank.

APPLICANT PROFILE: ${JSON.stringify(profile, null, 2)}
RULE ENGINE FLAGS: ${JSON.stringify(ruleResult.flags, null, 2)}
${emiData ? `PROJECTED EMI: ₹${emiData.monthlyEMI}/month | Total payable: ₹${emiData.totalPayable} | ${emiData.affordabilityNote}` : ''}

Perform a holistic credit assessment. Consider:
- Income stability vs. loan size
- Employment history and employer type
- Loan purpose (productive vs. consumptive)
- Existing EMI burden
- Any unusual patterns in the profile

Return ONLY valid JSON:
{
  "creditScore": 0-100,
  "recommendation": "approved|conditional|manual_review",
  "keyStrengths": ["..."],
  "keyRisks": ["..."],
  "additionalConditions": ["..."],
  "summary": "One sentence credit officer summary"
}`;

    try {
      return await this.callLLM({ systemPrompt, userMessage: 'Assess this applicant.', json: true });
    } catch (err) {
      this.log('error', 'LLM credit assessment failed, using safe fallback', { error: err.message });
      return {
        creditScore: 50, recommendation: 'manual_review',
        keyStrengths: [], keyRisks: ['Automated LLM assessment unavailable.'],
        additionalConditions: [], summary: 'Manual review required due to system limitation.',
      };
    }
  }

  _getField(fields, key) {
    if (Array.isArray(fields)) {
      const f = fields.find(f => f.key === key);
      return f ? parseFloat(f.finalValue ?? f.aiExtractedValue) || null : null;
    }
    return parseFloat(fields[key]) || null;
  }
}
