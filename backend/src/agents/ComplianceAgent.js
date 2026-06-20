import { BaseAgent } from './base/BaseAgent.js';

/**
 * ComplianceAgent
 *
 * Gate-keeper before the call can close.
 * Ensures all regulatory KYC requirements are satisfied.
 *
 * The PlannerAgent will NOT invoke DecisionAgent or close the call
 * until ComplianceAgent returns { canProceed: true }.
 *
 * Checks:
 *   1. All required fields are present
 *   2. All fields meet minimum confidence threshold
 *   3. Consent was properly recorded (with IP + timestamp)
 *   4. Fraud score is not in automatic-reject territory
 *
 * Input:  { sessionId, collectedFields, confidenceMap, consentData, fraudScore }
 * Output: { compliant, canProceed, missingRequirements[], warnings[], summary }
 */
export class ComplianceAgent extends BaseAgent {
  constructor() {
    super('ComplianceAgent');
  }

  async run({ sessionId, collectedFields = {}, confidenceMap = {}, consentData = {}, fraudScore = 0 }) {
    const thresholds = this.semanticMemory.getCreditThresholds();
    const allRequired = this.semanticMemory.getAllRequiredFieldKeys();

    const missingRequirements = [];
    const warnings            = [];

    // ── 1. Required fields present ────────────────────────────────────────────
    for (const field of allRequired) {
      const value = collectedFields[field];
      if (value === null || value === undefined || String(value).trim() === '') {
        missingRequirements.push({
          type:    'MISSING_FIELD',
          field,
          label:   this.semanticMemory.getFieldMeta(field).label,
          message: `Required field "${field}" was not collected`,
        });
      }
    }

    // ── 2. Confidence thresholds ──────────────────────────────────────────────
    for (const field of allRequired) {
      const value      = collectedFields[field];
      const confidence = confidenceMap[field] ?? 0;
      const meta       = this.semanticMemory.getFieldMeta(field);
      const minConf    = meta.minConfidence ?? thresholds.minOverallConfidence;

      if (value && confidence < minConf) {
        warnings.push({
          type:       'LOW_CONFIDENCE',
          field,
          label:      meta.label,
          confidence: parseFloat(confidence.toFixed(3)),
          threshold:  minConf,
          message:    `"${meta.label}" extracted with ${(confidence * 100).toFixed(0)}% confidence (min: ${(minConf * 100).toFixed(0)}%)`,
        });
      }
    }

    // ── 3. Consent check ─────────────────────────────────────────────────────
    if (!consentData?.ip || !consentData?.confirmedAt) {
      missingRequirements.push({
        type:    'MISSING_CONSENT',
        message: 'User consent with valid IP address and timestamp not on record',
      });
    }

    // ── 4. Fraud score gate ───────────────────────────────────────────────────
    if (fraudScore >= 70) {
      missingRequirements.push({
        type:    'HIGH_FRAUD_RISK',
        message: `Fraud risk score ${fraudScore}/100 exceeds automatic-review threshold (70). Manual review required before proceeding.`,
      });
    }

    const compliant   = missingRequirements.length === 0;
    const canProceed  = compliant; // Warnings don't block, but missing requirements do

    this.log('info', 'Compliance check complete', {
      sessionId, compliant,
      missing:  missingRequirements.length,
      warnings: warnings.length,
      fraudScore,
    });

    return {
      compliant,
      canProceed,
      missingRequirements,
      warnings,
      summary: compliant
        ? `All ${allRequired.length} required fields collected. ${warnings.length} warning(s). Ready for decision.`
        : `${missingRequirements.length} compliance requirement(s) not met. Cannot proceed.`,
    };
  }
}
