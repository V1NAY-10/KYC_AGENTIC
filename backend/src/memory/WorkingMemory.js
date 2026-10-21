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
 *   missingFields:   string[]    — requirements not yet met (e.g. 'govtId' = PAN or Aadhaar)
 *   skippedFields:   array       — [{ field, reason }] given up on after max attempts (officer review)
 *   fraudScore:      number      — 0-100 composite score
 *   fraudSignals:    array       — all fraud signals raised
 *   turnCount:       number      — how many turns have passed
 *   lastAgentAction: string|null
 *   probeField:      string|null — field being re-asked
 *   probeCount:      number      — failed attempts so far on probeField
 *   language:        string      — 'en' | 'hi'
 *   loanType:        string
 *   geoData:         object
 *   uploadedDocTypes: string[]   — ID documents uploaded before the call ('pan' | 'aadhaar')
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
   * Pass collectedFields/confidenceMap to rebuild state after a Redis loss
   * (they are mirrored to MongoDB every turn).
   */
  async init(sessionId, data = {}) {
    const existing = await this.get(sessionId);
    if (existing) return existing;

    const collectedFields = data.collectedFields || {};
    const state = {
      goals: semanticMemory.getGoals().map(g => g.id),
      completedGoals: [],
      activeGoal: 'collect_identity',
      collectedFields,
      confidenceMap: data.confidenceMap || {},
      missingFields: semanticMemory.computeMissingFields(collectedFields),
      skippedFields: [],
      fraudScore: 0,
      fraudSignals: [],
      turnCount: data.turnCount || 0,
      lastAgentAction: null,
      probeField: null,
      probeCount: 0,
      language: data.language || 'en',
      loanType: data.loanType || 'personal',
      geoData: data.geoData || {},
      uploadedDocTypes: data.uploadedDocTypes || [],
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

    // panNumber / aadhaarNumber also satisfy the govtId requirement
    const requirement = semanticMemory.getRequirementFor(key);

    current.collectedFields[key] = value;
    current.confidenceMap[key]   = confidence;
    current.missingFields = current.missingFields.filter(f => f !== key && f !== requirement);
    current.skippedFields = (current.skippedFields || []).filter(s => s.field !== key && s.field !== requirement);

    // Reset probe state if we just successfully collected the probe field
    if (current.probeField === key || current.probeField === requirement) {
      current.probeField = null;
      current.probeCount = 0;
    }

    await this.redis.setex(KEY(sessionId), TTL_SECONDS, JSON.stringify(current));
    return current;
  }

  /**
   * Count an unusable answer for a field. Returns the updated state;
   * state.probeCount is the number of consecutive failures on that field.
   */
  async recordFailedAttempt(sessionId, field) {
    const current = await this.get(sessionId);
    if (!current) throw new Error(`WorkingMemory not initialized for session: ${sessionId}`);

    if (current.probeField === field) {
      current.probeCount = (current.probeCount || 0) + 1;
    } else {
      current.probeField = field;
      current.probeCount = 1;
    }

    await this.redis.setex(KEY(sessionId), TTL_SECONDS, JSON.stringify(current));
    return current;
  }

  /**
   * Stop asking for a field after repeated failures so the interview never dead-ends.
   * The field stays empty (or holds a low-confidence value) and is flagged for the officer.
   */
  async skipField(sessionId, field, reason) {
    const current = await this.get(sessionId);
    if (!current) throw new Error(`WorkingMemory not initialized for session: ${sessionId}`);

    current.missingFields = current.missingFields.filter(f => f !== field);
    current.skippedFields = [...(current.skippedFields || []).filter(s => s.field !== field), { field, reason }];
    current.probeField = null;
    current.probeCount = 0;

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
