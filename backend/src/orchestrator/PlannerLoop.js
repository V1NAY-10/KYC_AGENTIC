import Session from '../models/Session.model.js';
import { PlannerAgent } from '../agents/PlannerAgent.js';
import { WorkingMemory } from '../memory/WorkingMemory.js';
import { withSessionLock } from '../utils/sessionLock.js';

// Singleton PlannerAgent — instantiated once, reused for all sessions
const planner       = new PlannerAgent();
const workingMemory = new WorkingMemory();

/**
 * PlannerLoop — Entry point called by socketHandler for every user turn.
 *
 * This thin wrapper:
 *   1. Serializes turns per session (no two turns mutate working memory at once)
 *   2. Loads the session from MongoDB (inside the lock, so status is current)
 *   3. Delegates to PlannerAgent.processTurn()
 *   4. Returns the response for socketHandler to emit
 *
 * Why a separate file from PlannerAgent?
 *   - socketHandler should not know about agent internals
 *   - This module is the bridge between infrastructure (sockets) and logic (agents)
 */

/**
 * Process one user turn in an active session.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.transcript  — transcribed user speech
 * @param {object} params.socket      — Socket.IO socket (for per-client events)
 * @param {object} params.io          — Socket.IO server (for room broadcasts)
 * @returns {Promise<object|null>}    — Response to emit, or null if session ended
 */
export function runPlannerLoop({ sessionId, transcript, socket, io }) {
  return withSessionLock(sessionId, async () => {
    const session = await Session.findById(sessionId);
    if (!session) {
      throw new Error(`PlannerLoop: Session ${sessionId} not found`);
    }

    if (session.status !== 'active') {
      console.warn(`[PlannerLoop] Session ${sessionId} is ${session.status} — ignoring turn`);
      return null;
    }

    return planner.processTurn({ sessionId, transcript, session, socket, io });
  });
}

/**
 * Initialize a brand-new session and emit the greeting.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.language   — 'en' | 'hi'
 * @param {object} params.socket
 * @param {object} params.io
 * @returns {Promise<object|null>}   — Greeting response, or null if another join already greeted
 */
export function startPlannerSession({ sessionId, language, socket, io }) {
  return withSessionLock(sessionId, async () => {
    const session = await Session.findById(sessionId);
    if (!session) {
      throw new Error(`PlannerLoop: Session ${sessionId} not found`);
    }

    // A concurrent join (double connect) may have greeted while we waited for the lock
    if (session.transcript?.some(t => t.role === 'agent')) return null;

    // Initialize working memory (idempotent — safe to call on reconnect)
    await workingMemory.init(sessionId, {
      language:         language || session.language || 'en',
      loanType:         session.loanType || 'personal',
      geoData:          session.geoData  || {},
      uploadedDocTypes: (session.documents || []).map(d => d.docType),
    });

    return planner.greet(sessionId, language || session.language || 'en');
  });
}
