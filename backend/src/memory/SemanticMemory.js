/**
 * SemanticMemory — Static domain knowledge base for the KYC system.
 *
 * This is NOT a vector DB or embeddings — it's a structured JS object
 * that agents query for rules, required fields, credit thresholds, and
 * fraud signal weights. Lives in memory; seeded at startup.
 *
 * Concept: Think of this as the "textbook" all agents share.
 */

const KYC_KNOWLEDGE = {
  // ── Required field groups ───────────────────────────────────────────────────
  requiredFields: {
    personal:  ['fullName', 'dateOfBirth', 'currentAddress', 'panNumber'],
    financial: ['monthlyIncome', 'employerName', 'employmentYears', 'existingEMI'],
    loan:      ['loanAmount', 'loanPurpose', 'loanTenure'],
  },

  // ── Per-field metadata ──────────────────────────────────────────────────────
  fieldMeta: {
    fullName:        { label: 'Full Name',               section: 'personal',  minConfidence: 0.80, mustValidate: false },
    dateOfBirth:     { label: 'Date of Birth',           section: 'personal',  minConfidence: 0.90, mustValidate: true  },
    currentAddress:  { label: 'Current Address',         section: 'personal',  minConfidence: 0.70, mustValidate: false },
    panNumber:       { label: 'PAN Number',              section: 'personal',  minConfidence: 0.95, mustValidate: true  },
    monthlyIncome:   { label: 'Monthly Income (₹)',      section: 'financial', minConfidence: 0.80, mustValidate: false },
    employerName:    { label: 'Employer Name',           section: 'financial', minConfidence: 0.75, mustValidate: false },
    employmentYears: { label: 'Years of Employment',     section: 'financial', minConfidence: 0.80, mustValidate: false },
    existingEMI:     { label: 'Existing EMI (₹/month)', section: 'financial', minConfidence: 0.75, mustValidate: false },
    loanAmount:      { label: 'Loan Amount (₹)',         section: 'loan',      minConfidence: 0.90, mustValidate: false },
    loanPurpose:     { label: 'Loan Purpose',            section: 'loan',      minConfidence: 0.75, mustValidate: false },
    loanTenure:      { label: 'Loan Tenure (months)',    section: 'loan',      minConfidence: 0.80, mustValidate: false },
  },

  // ── Credit decision thresholds ──────────────────────────────────────────────
  creditThresholds: {
    minMonthlyIncome:       15000,   // ₹ — below this → hard reject
    maxLoanToIncomeRatio:   24,      // loanAmount / monthlyIncome
    maxEMIBurdenRatio:      0.50,    // existingEMI / monthlyIncome
    minEmploymentMonths:    6,       // in months
    minOverallConfidence:   0.75,    // fields below this → manual review
    humanReviewThreshold:   0.60,    // overall decision confidence below this → manual
  },

  // ── Fraud signal weights (0-100 scale, cumulative) ──────────────────────────
  fraudSignalWeights: {
    VPN_DETECTED:              35,
    PROXY_DETECTED:            50,
    TOR_DETECTED:              70,
    CITY_MISMATCH:             20,
    STATE_MISMATCH:            15,
    PAN_INVALID:               40,
    INCOME_IMPLAUSIBLE:        30,
    CONTRADICTION_DETECTED:    45,
    AGE_IMPOSSIBLE:            60,
    PROMPT_INJECTION_DETECTED: 80,
    SUSPICIOUS_PAYLOAD_DETECTED: 40,
    UNUSUALLY_LONG_INPUT:      10,
  },

  // ── Planner goal definitions (priority order) ───────────────────────────────
  plannerGoals: [
    { id: 'collect_identity',    priority: 1, requiredFields: ['fullName', 'dateOfBirth', 'currentAddress', 'panNumber'], runsAsync: false },
    { id: 'verify_identity',     priority: 2, dependsOn: ['collect_identity'],                                           runsAsync: false },
    { id: 'collect_financial',   priority: 3, requiredFields: ['monthlyIncome', 'employerName', 'employmentYears', 'existingEMI'], runsAsync: false },
    { id: 'assess_fraud',        priority: 4, requiredFields: [],                                                        runsAsync: true  },
    { id: 'collect_loan_intent', priority: 5, requiredFields: ['loanAmount', 'loanPurpose', 'loanTenure'],               runsAsync: false },
    { id: 'run_credit_check',    priority: 6, dependsOn: ['collect_financial', 'collect_loan_intent'],                  runsAsync: true  },
    { id: 'verify_documents',    priority: 7, requiredFields: [],                                                        runsAsync: false },
    { id: 'compliance_check',    priority: 8, requiredFields: [],                                                        runsAsync: false },
    { id: 'final_decision',      priority: 9, dependsOn: ['compliance_check'],                                           runsAsync: false },
  ],
};

export class SemanticMemory {
  getRequiredFields() {
    return KYC_KNOWLEDGE.requiredFields;
  }

  getAllRequiredFieldKeys() {
    return Object.values(KYC_KNOWLEDGE.requiredFields).flat();
  }

  getFieldMeta(key) {
    return KYC_KNOWLEDGE.fieldMeta[key] || {
      label: key, section: 'personal', minConfidence: 0.75, mustValidate: false,
    };
  }

  getCreditThresholds() {
    return KYC_KNOWLEDGE.creditThresholds;
  }

  getFraudWeight(signalType) {
    return KYC_KNOWLEDGE.fraudSignalWeights[signalType] ?? 10;
  }

  getGoals() {
    return KYC_KNOWLEDGE.plannerGoals;
  }

  getGoal(id) {
    return KYC_KNOWLEDGE.plannerGoals.find(g => g.id === id) || null;
  }

  // Helper: given collected fields, compute which required fields are still missing
  computeMissingFields(collectedFields = {}) {
    const all = this.getAllRequiredFieldKeys();
    return all.filter(key => {
      const val = collectedFields[key];
      return val === null || val === undefined || val === '';
    });
  }
}
