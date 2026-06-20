import { BaseAgent } from './base/BaseAgent.js';

/**
 * FraudAgent
 *
 * Multi-dimensional fraud analysis — runs ASYNCHRONOUSLY (fire and forget)
 * so it never blocks the user's response.
 *
 * Dimensions checked:
 *   1. Geo fraud:        IP vs stated city/state mismatch, VPN/Proxy detection
 *   2. Data fraud:       Implausible values, impossible dates, suspicious patterns
 *   3. Behavioral fraud: Contradictions across collected fields
 *
 * Input:  sessionId, collectedFields, transcript, geoData, language, existingSignals
 * Output: { fraudScore, riskLevel, signals, recommendation, geoAnalysis }
 *
 * recommendation:
 *   'continue' — low risk, nothing unusual
 *   'probe'    — medium risk, ask clarifying questions
 *   'flag'     — high risk, mark for human review
 */
export class FraudAgent extends BaseAgent {
  constructor() {
    super('FraudAgent');
  }

  async run({ sessionId, collectedFields = {}, transcript = '', geoData = {}, language = 'en', existingSignals = [] }) {
    const allSignals = [...existingSignals];
    let totalScore   = 0;

    // ── 1. Geo risk (via fraudScorer tool) ────────────────────────────────────
    const statedCity  = this._extractCity(collectedFields.currentAddress);
    const statedState = this._extractState(collectedFields.currentAddress);

    try {
      const geoResult = await this.useTool('score_fraud', {
        signals:     existingSignals,
        geoData,
        statedCity,
        statedState,
      }, sessionId);

      totalScore += geoResult.score;
      allSignals.push(...(geoResult.flags || []));
    } catch (e) {
      this.log('warn', 'Geo fraud scoring failed', { sessionId, error: e.message });
    }

    // ── 2. Data consistency (LLM) — only if we have enough data ──────────────
    if (Object.keys(collectedFields).length >= 3) {
      try {
        const dataResult = await this._checkDataConsistency(collectedFields, transcript, language, sessionId);
        totalScore += dataResult.additionalScore || 0;
        allSignals.push(...(dataResult.signals || []));
      } catch (e) {
        this.log('warn', 'Data consistency check failed', { sessionId, error: e.message });
      }
    }

    const cappedScore = Math.min(100, totalScore);
    const riskLevel   = cappedScore >= 60 ? 'high' : cappedScore >= 30 ? 'medium' : 'low';
    const recommendation = cappedScore >= 70 ? 'flag' : cappedScore >= 40 ? 'probe' : 'continue';

    const geoAnalysis = {
      ipCity:      geoData?.city,
      ipState:     geoData?.state,
      statedCity,
      statedState,
      isVPN:       geoData?.isVPN || false,
      isProxy:     geoData?.isProxy || false,
    };

    this.log('info', 'Fraud analysis complete', { sessionId, fraudScore: cappedScore, riskLevel, recommendation });

    return { fraudScore: cappedScore, riskLevel, signals: allSignals, recommendation, geoAnalysis };
  }

  async _checkDataConsistency(collectedFields, transcript, language, sessionId) {
    const systemPrompt = `You are a fraud detection specialist reviewing a KYC loan interview.

COLLECTED DATA: ${JSON.stringify(collectedFields, null, 2)}
LATEST USER STATEMENT: "${transcript}"

Check for:
1. Contradictions (e.g., stated city ≠ address city)
2. Implausible values (income = 0, age < 18, loan amount unreasonably large)
3. Suspicious patterns (round income numbers like "exactly 50000", evasive answers)
4. Inconsistencies across fields (e.g., employer stated in city different from address)

Return ONLY valid JSON:
{
  "signals": [
    { "type": "SIGNAL_TYPE", "description": "what was detected", "severity": "low|medium|high", "field": "fieldKey" }
  ],
  "additionalScore": 0
}

If no issues found: return { "signals": [], "additionalScore": 0 }`;

    try {
      return await this.callLLM({ systemPrompt, userMessage: 'Analyze for fraud signals.', json: true });
    } catch (err) {
      this.log('error', 'Data consistency LLM failed', { sessionId, error: err.message });
      return { signals: [], additionalScore: 0 };
    }
  }

  // Simple address parsers — extracts approximate city/state from free-text address
  _extractCity(address) {
    if (!address) return null;
    const parts = String(address).split(',').map(s => s.trim()).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  }

  _extractState(address) {
    if (!address) return null;
    const parts = String(address).split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 1) return null;
    return parts[parts.length - 1].replace(/\d{6}/, '').trim() || null;
  }
}
