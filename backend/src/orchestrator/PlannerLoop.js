import Session from '../models/Session.model.js';
import { PlannerAgent } from '../agents/PlannerAgent.js';
import { WorkingMemory } from '../memory/WorkingMemory.js';

// Singleton PlannerAgent — instantiated once, reused for all sessions
const planner       = new PlannerAgent();
const workingMemory = new WorkingMemory();

/**
 * PlannerLoop — Entry point called by socketHandler for every user turn.
 *
 * This thin wrapper:
 *   1. Loads the session from MongoDB
 *   2. Delegates to PlannerAgent.processTurn()
 *   3. Returns the response for socketHandler to emit
 *
 * Why a separate file from PlannerAgent?
 *   - socketHandler should not know about agent internals
 *   - PlannerAgent should not import Session model or socket types
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
export async function runPlannerLoop({ sessionId, transcript, socket, io }) {
  const session = await Session.findById(sessionId);
  if (!session) {
    throw new Error(`PlannerLoop: Session ${sessionId} not found`);
  }

  if (session.status === 'completed') {
    console.warn(`[PlannerLoop] Session ${sessionId} already completed — ignoring turn`);
    return null;
  }

  return planner.processTurn({ sessionId, transcript, session, socket, io });
}

/**
 * Initialize a brand-new session and emit the greeting.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.language   — 'en' | 'hi'
 * @param {object} params.socket
 * @param {object} params.io
 * @returns {Promise<object>}        — Greeting response to emit
 */
export async function startPlannerSession({ sessionId, language, socket, io }) {
  const session = await Session.findById(sessionId);
  if (!session) {
    throw new Error(`PlannerLoop: Session ${sessionId} not found`);
  }

  // Initialize working memory (idempotent — safe to call on reconnect)
  await workingMemory.init(sessionId, {
    language: language || session.language || 'en',
    loanType: session.loanType || 'personal',
    geoData:  session.geoData  || {},
  });

  return planner.greet(sessionId, language || session.language || 'en');
}
