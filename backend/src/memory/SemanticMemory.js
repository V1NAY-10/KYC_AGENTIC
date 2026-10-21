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
  // A requirement is either a concrete field, or a group satisfied by ANY of its
  // `satisfiedBy` fields (see fieldMeta). govtId = PAN or Aadhaar, at least one.
  requiredFields: {
    personal:  ['fullName', 'dateOfBirth', 'currentAddress', 'govtId'],
    financial: ['monthlyIncome', 'employerName', 'employmentYears', 'existingEMI'],
    loan:      ['loanAmount', 'loanPurpose', 'loanTenure'],
  },

  // ── Per-field metadata ──────────────────────────────────────────────────────
  fieldMeta: {
    fullName:        { label: 'Full Name',               section: 'personal',  minConfidence: 0.80, mustValidate: false },
    dateOfBirth:     { label: 'Date of Birth',           section: 'personal',  minConfidence: 0.90, mustValidate: true  },
    currentAddress:  { label: 'Current Address',         section: 'personal',  minConfidence: 0.70, mustValidate: false },
    govtId:          { label: 'PAN or Aadhaar Number',   section: 'personal',  minConfidence: 0.90, mustValidate: true, satisfiedBy: ['panNumber', 'aadhaarNumber'] },
    panNumber:       { label: 'PAN Number',              section: 'personal',  minConfidence: 0.90, mustValidate: true  },
    aadhaarNumber:   { label: 'Aadhaar Number',          section: 'personal',  minConfidence: 0.90, mustValidate: true  },
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

  // ── Interview flow policy ─────────────────────────────────────────────────
  interviewPolicy: {
    // After this many unusable answers for one field, stop re-asking: keep the best
    // low-confidence value (or none) and flag it for the officer instead of looping.
    maxAttemptsPerField: 3,
    // Run the async FraudAgent when one of these is captured (each is an LLM call)
    fraudTriggerFields: ['currentAddress', 'monthlyIncome', 'loanAmount'],
  },

  // ── Fraud signal weights (0-100 scale, cumulative) ──────────────────────────
  fraudSignalWeights: {
    VPN_DETECTED:              35,
    PROXY_DETECTED:            50,
    TOR_DETECTED:              70,
    CITY_MISMATCH:             20,
    STATE_MISMATCH:            15,
    PAN_INVALID:               40,
    AADHAAR_INVALID:           40,
    INCOME_IMPLAUSIBLE:        30,
    CONTRADICTION_DETECTED:    45,
    AGE_IMPOSSIBLE:            60,
    PROMPT_INJECTION_DETECTED: 80,
    SUSPICIOUS_PAYLOAD_DETECTED: 40,
    UNUSUALLY_LONG_INPUT:      10,
  },

  // ── Planner goal definitions (priority order) ───────────────────────────────
  plannerGoals: [
    { id: 'collect_identity',    priority: 1, requiredFields: ['fullName', 'dateOfBirth', 'currentAddress', 'govtId'],    runsAsync: false },
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

  /** Requirement keys in interview order (may include groups like govtId). */
  getAllRequiredFieldKeys() {
    return Object.values(KYC_KNOWLEDGE.requiredFields).flat();
  }

  /** Concrete fields that can satisfy a requirement — [key] for plain fields. */
  getSatisfyingFields(requirementKey) {
    return KYC_KNOWLEDGE.fieldMeta[requirementKey]?.satisfiedBy || [requirementKey];
  }

  /** The requirement a concrete field counts towards (panNumber → govtId). */
  getRequirementFor(fieldKey) {
    for (const req of this.getAllRequiredFieldKeys()) {
      if (this.getSatisfyingFields(req).includes(fieldKey)) return req;
    }
    return fieldKey;
  }

  isRequirementMet(requirementKey, collectedFields = {}) {
    return this.getSatisfyingFields(requirementKey).some(key => {
      const val = collectedFields[key];
      return val !== null && val !== undefined && String(val).trim() !== '';
    });
  }

  /** Concrete fields shown on the review form / stored on the application, in order. */
  getReviewFieldKeys() {
    return this.getAllRequiredFieldKeys().flatMap(req => this.getSatisfyingFields(req));
  }

  /** Every concrete field the extractor may return. */
  getExtractableFieldKeys() {
    return this.getReviewFieldKeys();
  }

  getInterviewPolicy() {
    return KYC_KNOWLEDGE.interviewPolicy;
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
    return this.getAllRequiredFieldKeys().filter(key => !this.isRequirementMet(key, collectedFields));
  }
}
