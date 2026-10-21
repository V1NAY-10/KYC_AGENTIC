import { BaseAgent } from './base/BaseAgent.js';
import { scoreSignals, riskLevelFor } from '../utils/fraudScore.js';
import { ageFromDob, todayLabel } from '../utils/age.js';

const INDIAN_STATES = [
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat',
  'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh',
  'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'orissa', 'punjab',
  'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh', 'uttarakhand',
  'west bengal', 'delhi', 'new delhi', 'jammu and kashmir', 'ladakh', 'puducherry', 'pondicherry',
  'chandigarh', 'andaman and nicobar islands', 'dadra and nagar haveli and daman and diu', 'lakshadweep',
];

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
    const newSignals = [];

    // ── 1. Geo risk (via fraudScorer tool) ────────────────────────────────────
    const { city: statedCity, state: statedState } = this._parseAddress(collectedFields.currentAddress);

    try {
      // Geo checks only — existing signals are scored once, below, with everything else
      const geoResult = await this.useTool('score_fraud', {
        signals:     [],
        geoData,
        statedCity,
        statedState,
      }, sessionId);

      newSignals.push(...(geoResult.flags || []));
    } catch (e) {
      this.log('warn', 'Geo fraud scoring failed', { sessionId, error: e.message });
    }

    // ── 2. Data consistency (LLM) — only if we have enough data ──────────────
    if (Object.keys(collectedFields).length >= 3) {
      try {
        const dataResult = await this._checkDataConsistency(collectedFields, transcript, language, sessionId);
        newSignals.push(...(dataResult.signals || []));
      } catch (e) {
        this.log('warn', 'Data consistency check failed', { sessionId, error: e.message });
      }
    }

    const allSignals  = [...existingSignals, ...newSignals];
    const cappedScore = scoreSignals(allSignals);
    const riskLevel   = riskLevelFor(cappedScore);
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
    const age = ageFromDob(collectedFields.dateOfBirth);
    const systemPrompt = `You are a fraud detection specialist reviewing a KYC loan interview.

TODAY'S DATE: ${todayLabel()}
APPLICANT AGE (computed from date of birth — trust this, do not recalculate): ${age ?? 'unknown'}
COLLECTED DATA: ${JSON.stringify(collectedFields, null, 2)}
LATEST USER STATEMENT: "${transcript}"

Check for:
1. Contradictions between fields or with the latest statement
2. Implausible values (income = 0, applicant age under 18, loan amount unreasonably large)
3. Suspicious patterns (round income numbers like "exactly 50000", evasive answers)
4. Inconsistencies across fields (e.g., employer stated in city different from address)

Do NOT raise IP / geolocation issues — those are checked separately.

Return ONLY valid JSON:
{
  "signals": [
    { "type": "SIGNAL_TYPE", "description": "what was detected", "severity": "low|medium|high", "field": "fieldKey" }
  ],
  "additionalScore": 0
}

If no issues found: return { "signals": [], "additionalScore": 0 }`;

    try {
      return await this.callLLM({ systemPrompt, userMessage: 'Analyze for fraud signals.', json: true, lane: 'secondary' });
    } catch (err) {
      this.log('error', 'Data consistency LLM failed', { sessionId, error: err.message });
      return { signals: [], additionalScore: 0 };
    }
  }

  /**
   * Approximate city / state from a free-text Indian address.
   * "Flat 4, MG Road, Pune, Maharashtra 411001" → { city: 'Pune', state: 'Maharashtra' }
   * "C108 Greenwald, Navi Mumbai"               → { city: 'Navi Mumbai', state: null }
   */
  _parseAddress(address) {
    if (!address) return { city: null, state: null };
    const parts = String(address)
      .split(',')
      .map(p => p.replace(/\b\d{6}\b/g, '').replace(/\bindia\b/i, '').trim())
      .filter(Boolean);
    if (parts.length === 0) return { city: null, state: null };

    const stateIdx = parts.findLastIndex(p => INDIAN_STATES.includes(p.toLowerCase()));
    if (stateIdx >= 0) {
      const city = stateIdx > 0 ? parts[stateIdx - 1] : null;
      return { city: city && !/\d/.test(city) ? city : null, state: parts[stateIdx] };
    }

    // No state named — the last part without house/flat numbers is the best city guess
    const last = parts[parts.length - 1];
    return { city: /\d/.test(last) ? null : last, state: null };
  }
}
