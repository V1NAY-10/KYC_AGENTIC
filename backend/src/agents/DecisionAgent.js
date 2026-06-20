import { BaseAgent } from './base/BaseAgent.js';

/**
 * DecisionAgent
 *
 * Final synthesis — combines CreditAgent, FraudAgent, and ComplianceAgent outputs
 * into a single, well-reasoned loan decision with per-dimension confidence scores.
 *
 * New vs. old loanEngine:
 *   - Multi-dimensional confidence scoring (identity, fraud, credit, compliance)
 *   - Overall confidence threshold for human review (< 60% → manual_review regardless)
 *   - Full decision trace returned for audit storage
 *
 * Input:  { sessionId, creditResult, fraudResult, complianceResult, identityConfidences }
 * Output: { decision, overallConfidence, score, dimensionScores, reasons, conditions,
 *           humanReviewRequired, decidedAt, ... }
 */
export class DecisionAgent extends BaseAgent {
  constructor() {
    super('DecisionAgent');
  }

  async run({ sessionId, creditResult, fraudResult, complianceResult, identityConfidences = {} }) {
    const thresholds = this.semanticMemory.getCreditThresholds();

    // ── Per-dimension confidence scores (0.0–1.0) ─────────────────────────────
    const identityScore    = this._avgConfidence(identityConfidences);
    const fraudInverseScore = Math.max(0, 1 - (fraudResult.fraudScore / 100)); // High fraud → low score
    const creditConfidence  = Math.min(1, (creditResult.score || 50) / 100);
    const complianceScore   = complianceResult.compliant
      ? 1.0
      : Math.max(0, 1 - complianceResult.missingRequirements.length * 0.25);

    // Weighted overall confidence
    const overallConfidence = (
      identityScore    * 0.30 +
      fraudInverseScore * 0.25 +
      creditConfidence  * 0.30 +
      complianceScore   * 0.15
    );

    // ── Decision logic ────────────────────────────────────────────────────────
    const humanReviewRequired = (
      overallConfidence < thresholds.humanReviewThreshold ||
      fraudResult.riskLevel === 'high'                   ||
      !complianceResult.canProceed
    );

    let finalDecision = creditResult.decision;

    if (!complianceResult.canProceed) {
      finalDecision = 'manual_review';
    } else if (humanReviewRequired && finalDecision === 'approved') {
      finalDecision = 'manual_review';
    }

    this.log('info', 'Final decision made', {
      sessionId,
      decision:        finalDecision,
      confidence:      overallConfidence.toFixed(3),
      humanReview:     humanReviewRequired,
      fraudRisk:       fraudResult.riskLevel,
      complianceOk:    complianceResult.canProceed,
    });

    return {
      decision:           finalDecision,
      overallConfidence:  parseFloat(overallConfidence.toFixed(3)),
      score:              creditResult.score || 50,

      // Per-dimension breakdown (visible to loan officers)
      dimensionScores: {
        identity:   parseFloat(identityScore.toFixed(3)),
        fraud:      parseFloat(fraudInverseScore.toFixed(3)),
        credit:     parseFloat(creditConfidence.toFixed(3)),
        compliance: parseFloat(complianceScore.toFixed(3)),
      },

      reasons:    creditResult.reasons    || [],
      conditions: creditResult.conditions || [],
      ruleFlags:  creditResult.ruleFlags  || {},

      emiProjection: creditResult.emiProjection || null,
      llmAssessment: creditResult.llmAssessment || null,

      fraudAnalysis: {
        score:     fraudResult.fraudScore,
        riskLevel: fraudResult.riskLevel,
        signals:   fraudResult.signals || [],
      },

      complianceWarnings: complianceResult.warnings || [],
      humanReviewRequired,
      decidedAt: new Date(),
    };
  }

  _avgConfidence(confidenceMap) {
    if (!confidenceMap || typeof confidenceMap !== 'object') return 0.70;
    const values = Object.values(confidenceMap).filter(v => typeof v === 'number' && v >= 0);
    if (values.length === 0) return 0.70;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
}
