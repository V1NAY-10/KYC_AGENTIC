import ToolCallLog from '../models/ToolCallLog.model.js';
import { sanitizePII } from '../middleware/piiSanitizer.middleware.js';

/**
 * ToolRegistry — Central registry for all agent tools.
 *
 * Why a central registry?
 * - Every tool call is automatically logged to MongoDB (PII-sanitized)
 * - Agents never call tools directly — they go through the registry
 * - Adding a new tool (e.g., OCR) requires zero changes to agents
 * - Returns OpenAI/Groq-compatible function schemas for native tool calling
 *
 * Concept: Think of this as the "toolbox" shared by all agents.
 *
 * A Tool Definition object has:
 *   name:        string   — unique identifier (snake_case)
 *   description: string   — what the tool does (used in LLM prompts)
 *   parameters:  object   — { paramName: { type, description } }
 *   execute:     async fn — the actual implementation
 */
class ToolRegistryClass {
  constructor() {
    this._tools = new Map();
  }

  /** Register a new tool. Throws if a tool with the same name is already registered. */
  register(toolDef) {
    if (!toolDef?.name || !toolDef?.execute) {
      throw new Error(`[ToolRegistry] Tool must have name and execute function`);
    }
    if (this._tools.has(toolDef.name)) {
      console.warn(`[ToolRegistry] Tool "${toolDef.name}" already registered — skipping`);
      return;
    }
    this._tools.set(toolDef.name, toolDef);
  }

  /** Get all registered tool definitions. */
  getAll() {
    return Array.from(this._tools.values());
  }

  hasTool(name) {
    return this._tools.has(name);
  }

  /**
   * Returns OpenAI/Groq-compatible function calling schemas.
   * Pass these to the LLM's `tools` parameter for native tool calling.
   */
  getSchemas() {
    return this.getAll().map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: t.parameters || {},
          required: Object.keys(t.parameters || {}),
        },
      },
    }));
  }

  /**
   * Execute a tool by name.
   * Automatically:
   *   1. Times the execution
   *   2. Logs to ToolCallLog (PII-sanitized, non-blocking)
   *   3. Throws on failure with the tool name in the error message
   *
   * @param {string} toolName
   * @param {object} args
   * @param {object} [context] - { sessionId, agentName }
   * @returns {Promise<*>} Tool output
   */
  async execute(toolName, args, context = {}) {
    const tool = this._tools.get(toolName);
    if (!tool) throw new Error(`[ToolRegistry] Tool not found: "${toolName}"`);

    const startMs = Date.now();
    let success = true;
    let output  = null;
    let errorMsg = null;

    try {
      output = await tool.execute(args);
    } catch (err) {
      success = false;
      errorMsg = err.message;
    }

    const durationMs = Date.now() - startMs;

    // Fire-and-forget logging — never blocks the agent
    if (context.sessionId) {
      ToolCallLog.create({
        sessionId:  context.sessionId,
        agentName:  context.agentName || 'unknown',
        toolName,
        input:      sanitizePII(args),
        output:     sanitizePII(output),
        durationMs,
        success,
        error:      errorMsg,
      }).catch(e => console.error('[ToolCallLog] Save failed:', e.message));
    }

    if (!success) {
      throw new Error(`Tool "${toolName}" failed: ${errorMsg}`);
    }

    return output;
  }
}

// Singleton instance shared across all agents
export const ToolRegistry = new ToolRegistryClass();
