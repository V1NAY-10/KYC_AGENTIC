import { getRedis } from '../config/redis.js';
import { SemanticMemory } from './SemanticMemory.js';

const TTL_SECONDS  = 4 * 60 * 60; // 4 hours — auto-expires dead sessions
const KEY = (sid) => `wm:${sid}`;

const semanticMemory = new SemanticMemory();

/**
 * WorkingMemory — Redis-backed short-term memory for an active KYC call.
 *
 * Why Redis?
 *   - Sub-millisecond reads (vs ~50ms for MongoDB)
 *   - Survives server restarts (unlike in-process Map)
 *   - Automatic TTL expiry for dead sessions
 *
 * Schema stored as a single JSON string per session:
 * {
 *   goals:           string[]    — all planner goals (ordered)
 *   completedGoals:  string[]    — goals marked done
 *   activeGoal:      string      — current goal being worked on
 *   collectedFields: object      — { fieldKey: value }
 *   confidenceMap:   object      — { fieldKey: 0.0-1.0 }
 *   missingFields:   string[]    — fields not yet collected
 *   fraudScore:      number      — 0-100 composite score
 *   fraudSignals:    array       — all fraud signals raised
 *   turnCount:       number      — how many turns have passed
 *   lastAgentAction: string|null
 *   probeField:      string|null — field being re-asked
 *   probeCount:      number      — how many times we've probed this field
 *   language:        string      — 'en' | 'hi'
 *   loanType:        string
 *   geoData:         object
 * }
 */
export class WorkingMemory {
  constructor() {
    this.redis = getRedis();
  }

  /** Read the full working memory for a session. Returns null if not found. */
  async get(sessionId) {
    try {
      const raw = await this.redis.get(KEY(sessionId));
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error('[WorkingMemory.get] Redis error:', err.message);
      return null;
    }
  }

  /**
   * Initialize working memory for a new session.
   * Safe to call multiple times — won't overwrite an existing session.
   */
  async init(sessionId, data = {}) {
    const existing = await this.get(sessionId);
    if (existing) return existing;

    const allRequired = semanticMemory.getAllRequiredFieldKeys();
    const state = {
      goals: semanticMemory.getGoals().map(g => g.id),
      completedGoals: [],
      activeGoal: 'collect_identity',
      collectedFields: {},
      confidenceMap: {},
      missingFields: [...allRequired],
      fraudScore: 0,
      fraudSignals: [],
      turnCount: 0,
      lastAgentAction: null,
      probeField: null,
      probeCount: 0,
      language: data.language || 'en',
      loanType: data.loanType || 'personal',
      geoData: data.geoData || {},
    };

    await this.redis.setex(KEY(sessionId), TTL_SECONDS, JSON.stringify(state));
    return state;
  }

  /** Apply a partial patch to working memory. Returns the updated state. */
  async update(sessionId, patch) {
    const current = await this.get(sessionId);
    if (!current) throw new Error(`WorkingMemory not initialized for session: ${sessionId}`);
    const updated = { ...current, ...patch };
    await this.redis.setex(KEY(sessionId), TTL_SECONDS, JSON.stringify(updated));
    return updated;
  }

  /**
   * Record a successfully extracted field.
   * Removes it from missingFields, updates collectedFields + confidenceMap.
   */
  async setField(sessionId, key, value, confidence) {
    const current = await this.get(sessionId);
    if (!current) throw new Error(`WorkingMemory not initialized for session: ${sessionId}`);

    current.collectedFields[key] = value;
    current.confidenceMap[key]   = confidence;
    current.missingFields = current.missingFields.filter(f => f !== key);

    // Reset probe state if we just successfully collected the probe field
    if (current.probeField === key) {
      current.probeField = null;
      current.probeCount = 0;
    }

    await this.redis.setex(KEY(sessionId), TTL_SECONDS, JSON.stringify(current));
    return current;
  }

  /**
   * Add a fraud signal and increment the fraud score.
   * The signal weight comes from SemanticMemory.
   */
  async addFraudSignal(sessionId, signal) {
    const current = await this.get(sessionId);
    if (!current) return null;

    const weight = signal.weight ?? semanticMemory.getFraudWeight(signal.type);
    current.fraudSignals = [...(current.fraudSignals || []), { ...signal, weight }];
    current.fraudScore   = Math.min(100, (current.fraudScore || 0) + weight);

    await this.redis.setex(KEY(sessionId), TTL_SECONDS, JSON.stringify(current));
    return current;
  }

  /** Mark a goal as completed. */
  async completeGoal(sessionId, goalId) {
    const current = await this.get(sessionId);
    if (!current) return null;

    if (!current.completedGoals.includes(goalId)) {
      current.completedGoals.push(goalId);
    }

    // Advance activeGoal to the next uncompleted goal
    const nextGoal = current.goals.find(g => !current.completedGoals.includes(g));
    current.activeGoal = nextGoal || 'final_decision';

    await this.redis.setex(KEY(sessionId), TTL_SECONDS, JSON.stringify(current));
    return current;
  }

  /** Delete the working memory entry (e.g., after session ends). */
  async clear(sessionId) {
    await this.redis.del(KEY(sessionId));
  }
}
