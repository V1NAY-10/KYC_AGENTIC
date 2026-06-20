import { SemanticMemory } from '../memory/SemanticMemory.js';

const semanticMemory = new SemanticMemory();

/**
 * Fraud Scorer Tool
 *
 * Combines raw fraud signals + geo mismatch into a single composite risk score.
 * Score: 0–100. Risk levels: low (<30), medium (30–59), high (≥60).
 *
 * Weights come from SemanticMemory.fraudSignalWeights — configurable in one place.
 */
export const fraudScorerTool = {
  name: 'score_fraud',
  description: 'Computes a composite fraud risk score from collected signals and geo data mismatch.',
  parameters: {
    signals:     { type: 'array',  description: 'Array of { type, severity, weight? } fraud signal objects' },
    geoData:     { type: 'object', description: 'Geo lookup result: { city, state, isVPN, isProxy, isTor }' },
    statedCity:  { type: 'string', description: 'City the user verbally stated during interview' },
    statedState: { type: 'string', description: 'State the user verbally stated during interview' },
  },

  execute: async ({ signals = [], geoData = {}, statedCity, statedState }) => {
    let score = 0;
    const breakdown = {};
    const resultFlags = [];

    // Score existing signals (use their weight or look up from SemanticMemory)
    for (const signal of signals) {
      const weight = signal.weight ?? semanticMemory.getFraudWeight(signal.type);
      score += weight;
      breakdown[signal.type] = (breakdown[signal.type] || 0) + weight;
      resultFlags.push({ ...signal, weight });
    }

    // Geo-based signals
    if (geoData.isVPN) {
      const w = semanticMemory.getFraudWeight('VPN_DETECTED');
      score += w;
      breakdown.VPN_DETECTED = w;
      resultFlags.push({ type: 'VPN_DETECTED', description: 'User appears to be on a VPN or hosting provider', severity: 'medium', weight: w });
    }

    if (geoData.isProxy) {
      const w = semanticMemory.getFraudWeight('PROXY_DETECTED');
      score += w;
      breakdown.PROXY_DETECTED = w;
      resultFlags.push({ type: 'PROXY_DETECTED', description: 'Proxy server detected', severity: 'high', weight: w });
    }

    if (geoData.isTor) {
      const w = semanticMemory.getFraudWeight('TOR_DETECTED');
      score += w;
      breakdown.TOR_DETECTED = w;
      resultFlags.push({ type: 'TOR_DETECTED', description: 'Tor exit node detected', severity: 'high', weight: w });
    }

    // City mismatch
    if (statedCity && geoData.city) {
      const ipCity     = geoData.city.toLowerCase().trim();
      const claimedCity = statedCity.toLowerCase().trim();
      if (!ipCity.includes(claimedCity) && !claimedCity.includes(ipCity)) {
        const w = semanticMemory.getFraudWeight('CITY_MISMATCH');
        score += w;
        breakdown.CITY_MISMATCH = w;
        resultFlags.push({
          type: 'CITY_MISMATCH',
          description: `IP location: ${geoData.city}. Stated city: ${statedCity}`,
          severity: 'medium',
          weight: w,
        });
      }
    }

    // State mismatch
    if (statedState && geoData.state) {
      const ipState    = geoData.state.toLowerCase().trim();
      const claimedState = statedState.toLowerCase().trim();
      if (!ipState.includes(claimedState) && !claimedState.includes(ipState)) {
        const w = semanticMemory.getFraudWeight('STATE_MISMATCH');
        score += w;
        breakdown.STATE_MISMATCH = w;
        resultFlags.push({
          type: 'STATE_MISMATCH',
          description: `IP state: ${geoData.state}. Stated state: ${statedState}`,
          severity: 'medium',
          weight: w,
        });
      }
    }

    const cappedScore = Math.min(100, score);
    const riskLevel = cappedScore >= 60 ? 'high' : cappedScore >= 30 ? 'medium' : 'low';

    return { score: cappedScore, riskLevel, breakdown, flags: resultFlags };
  },
};
