import { chat } from '../../services/ai/llm.service.js';
import { WorkingMemory } from '../../memory/WorkingMemory.js';
import { EpisodicMemory } from '../../memory/EpisodicMemory.js';
import { SemanticMemory } from '../../memory/SemanticMemory.js';
import { DecisionMemory } from '../../memory/DecisionMemory.js';
import { ToolRegistry } from '../../tools/ToolRegistry.js';

const MAX_RETRIES  = 3;
const RETRY_DELAYS = [0, 1000, 3000]; // ms between retries

/**
 * BaseAgent — Abstract base class for all KYC agents.
 *
 * Provides:
 *   - Shared memory access (all 4 tiers)
 *   - Shared ToolRegistry reference
 *   - LLM call wrapper with automatic retry + exponential backoff
 *   - Structured logging (agent name pre-bound)
 *   - Tool execution helper
 *
 * All agents extend this class and implement run(context).
 */
export class BaseAgent {
  constructor(name) {
    if (!name) throw new Error('BaseAgent requires a name');
    this.name = name;

    // ── Shared memory instances ───────────────────────────────────────────
    this.workingMemory  = new WorkingMemory();
    this.episodicMemory = new EpisodicMemory();
    this.semanticMemory = new SemanticMemory();
    this.decisionMemory = new DecisionMemory();

    // ── Shared tool registry ──────────────────────────────────────────────
    this.tools = ToolRegistry;
  }

  /**
   * Main agent execution method. MUST be overridden by subclasses.
   * @param {object} context - Agent-specific input
   * @returns {Promise<object>} Agent-specific output
   */
  async run(context) {
    throw new Error(`${this.name}.run() not implemented`);
  }

  /**
   * LLM call with automatic retry and exponential backoff.
   *
   * Retry strategy:
   *   Attempt 1: immediate
   *   Attempt 2: after 1s
   *   Attempt 3: after 3s
   *   Fallback: throws the last error (caller handles graceful degradation)
   *
   * @param {object} options
   * @param {string} options.systemPrompt
   * @param {string} options.userMessage
   * @param {boolean} [options.json=true]
   * @returns {Promise<object|string>}
   */
  async callLLM({ systemPrompt, userMessage, json = true }) {
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(res => setTimeout(res, RETRY_DELAYS[attempt]));
        this.log('warn', `LLM retry attempt ${attempt + 1}/${MAX_RETRIES}`);
      }

      try {
        return await chat({ systemPrompt, userMessage, json });
      } catch (err) {
        lastError = err;
        this.log('error', `LLM call failed (attempt ${attempt + 1})`, { error: err.message });
      }
    }

    this.log('error', 'All LLM retries exhausted', { error: lastError?.message });
    throw lastError;
  }

  /**
   * Execute a tool through the ToolRegistry (with automatic logging).
   * @param {string} toolName
   * @param {object} args
   * @param {string} [sessionId]
   */
  async useTool(toolName, args, sessionId) {
    return this.tools.execute(toolName, args, {
      sessionId,
      agentName: this.name,
    });
  }

  /**
   * Structured logging — every log entry includes agent name and timestamp.
   * Replace the console.* calls with pino when adding full observability.
   *
   * @param {'info'|'warn'|'error'|'debug'} level
   * @param {string} message
   * @param {object} [data]
   */
  log(level, message, data = {}) {
    const entry = {
      ts:      new Date().toISOString(),
      agent:   this.name,
      level,
      message,
      ...data,
    };
    if (level === 'error') console.error(JSON.stringify(entry));
    else if (level === 'warn')  console.warn(JSON.stringify(entry));
    else                        console.log(JSON.stringify(entry));
  }
}
