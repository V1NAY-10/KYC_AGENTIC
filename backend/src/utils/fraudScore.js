import { SemanticMemory } from '../memory/SemanticMemory.js';

const semanticMemory = new SemanticMemory();

const GEO_MISMATCH_TYPES = new Set(['CITY_MISMATCH', 'STATE_MISMATCH']);

/** Geo mismatches are meaningless when the IP has no real location (localhost / private network). */
export function isGeoMismatch(signal) {
  return GEO_MISMATCH_TYPES.has(signal?.type);
}

/**
 * Composite 0–100 score for a set of signals. Each distinct (type, field) counts
 * once, so re-running fraud checks every turn can't inflate the score.
 */
export function scoreSignals(signals = []) {
  const weights = new Map();
  for (const s of signals) {
    if (!s?.type) continue;
    const key = `${s.type}|${s.field || ''}`;
    const w = s.weight ?? semanticMemory.getFraudWeight(s.type);
    weights.set(key, Math.max(weights.get(key) || 0, w));
  }
  let total = 0;
  for (const w of weights.values()) total += w;
  return Math.min(100, total);
}

export const riskLevelFor = (score) => (score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low');
