import { chat, isRetryableLLMError, retryAfterMs } from '../../services/ai/llm.service.js';
import { WorkingMemory } from '../../memory/WorkingMemory.js';
import { EpisodicMemory } from '../../memory/EpisodicMemory.js';
import { SemanticMemory } from '../../memory/SemanticMemory.js';
import { DecisionMemory } from '../../memory/DecisionMemory.js';
import { ToolRegistry } from '../../tools/ToolRegistry.js';

const MAX_RETRIES  = 3;
const RETRY_DELAYS = [0, 400, 1200]; // ms between retries — kept short, the user is waiting on a live call
const MAX_RATE_LIMIT_WAIT_MS = 2500;

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
   *   Attempt 2: after 400ms
   *   Attempt 3: after 1.2s
   *   Non-retryable errors (401/403/404/400) fail immediately
   *   Fallback: throws the last error (caller handles graceful degradation)
   *
   * @param {object} options
   * @param {string} options.systemPrompt
   * @param {string} options.userMessage
   * @param {boolean} [options.json=true]
   * @param {'primary'|'secondary'} [options.lane='primary'] - model lane (see llm.service chat())
   * @returns {Promise<object|string>}
   */
  async callLLM({ systemPrompt, userMessage, json = true, lane = 'primary' }) {
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Rate limited → wait what the provider asked (capped), else the normal backoff
        const asked = lastError?.status === 429 ? retryAfterMs(lastError) : null;
        const delay = asked ? Math.min(asked + 100, MAX_RATE_LIMIT_WAIT_MS) : RETRY_DELAYS[attempt];
        await new Promise(res => setTimeout(res, delay));
        this.log('warn', `LLM retry attempt ${attempt + 1}/${MAX_RETRIES}`);
      }

      try {
        return await chat({ systemPrompt, userMessage, json, lane });
      } catch (err) {
        lastError = err;
        this.log('error', `LLM call failed (attempt ${attempt + 1})`, { error: err.message });
        if (!isRetryableLLMError(err)) break;
      }
    }

    this.log('error', 'LLM call gave up', { error: lastError?.message });
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
