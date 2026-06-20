import AgentTrace from '../models/AgentTrace.model.js';
import AgentPlan from '../models/AgentPlan.model.js';

/**
 * DecisionMemory — MongoDB-backed decision audit trail.
 *
 * Stores every Planner decision (AgentTrace) and the current plan (AgentPlan).
 * Used for: compliance audits, debugging, human review, and replay.
 */
export class DecisionMemory {
  /**
   * Save one turn's decision trace.
   * Called at the end of every PlannerAgent.processTurn().
   */
  async saveTrace(sessionId, traceData) {
    try {
      const trace = new AgentTrace({ sessionId, ...traceData });
      await trace.save();
      return trace;
    } catch (err) {
      // Non-fatal — don't crash the call if trace save fails
      console.error('[DecisionMemory.saveTrace] Failed:', err.message);
      return null;
    }
  }

  /** Get all decision traces for a session, in chronological order. */
  async getTraces(sessionId) {
    return AgentTrace.find({ sessionId })
      .sort({ turn: 1 })
      .lean();
  }

  /**
   * Upsert the current agent plan.
   * The plan is a single document per session, updated as goals change.
   */
  async savePlan(sessionId, planData) {
    try {
      await AgentPlan.findOneAndUpdate(
        { sessionId },
        { ...planData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      console.error('[DecisionMemory.savePlan] Failed:', err.message);
    }
  }

  /** Get the latest plan for a session. */
  async getLatestPlan(sessionId) {
    return AgentPlan.findOne({ sessionId }).lean();
  }

  /** Count total turns in a session (from traces). */
  async getTurnCount(sessionId) {
    return AgentTrace.countDocuments({ sessionId });
  }
}
