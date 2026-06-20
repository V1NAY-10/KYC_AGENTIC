import Session from '../models/Session.model.js';

/**
 * EpisodicMemory — MongoDB-backed conversation history.
 *
 * Wraps the existing Session.transcript[] array with a clean API.
 * This is the "long-term" memory of what was said in the call.
 */
export class EpisodicMemory {
  /**
   * Get the N most recent turns from the transcript.
   * Default: last 6 turns (3 exchanges) for context.
   */
  async getRecentTurns(sessionId, n = 6) {
    const session = await Session.findById(sessionId)
      .select('transcript')
      .lean();
    if (!session) return [];
    return (session.transcript || []).slice(-n);
  }

  /** Get all utterances the user made (not Aria's). */
  async getAllUserUtterances(sessionId) {
    const session = await Session.findById(sessionId)
      .select('transcript')
      .lean();
    if (!session) return [];
    return (session.transcript || []).filter(t => t.role === 'user');
  }

  /** Return the full transcript array. */
  async getFullTranscript(sessionId) {
    const session = await Session.findById(sessionId)
      .select('transcript')
      .lean();
    return session?.transcript || [];
  }

  /**
   * Append one turn to the transcript.
   * @param {string} sessionId
   * @param {'agent'|'user'} role
   * @param {string} text
   * @param {object} metadata - e.g. { state: 'AGENTIC' }
   */
  async appendTurn(sessionId, role, text, metadata = {}) {
    await Session.findByIdAndUpdate(sessionId, {
      $push: {
        transcript: {
          role,
          text,
          state: metadata.state || 'AGENTIC',
          timestamp: new Date(),
        },
      },
    });
  }

  /** Replay the last agent message (for reconnect). */
  async getLastAgentMessage(sessionId) {
    const transcript = await this.getFullTranscript(sessionId);
    return [...transcript].reverse().find(t => t.role === 'agent') || null;
  }
}
