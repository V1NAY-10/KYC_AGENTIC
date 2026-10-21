import { groq, MODEL_NAME, FALLBACK_MODEL } from '../../config/llm.js';

// Switches to FALLBACK_MODEL for the rest of the process once the primary is found unavailable
let activeModel = MODEL_NAME;

/**
 * Generic chat function — all AI calls go through here.
 * Uses Groq via the OpenAI-compatible SDK.
 *
 * Rate limits on Groq are per model, so a 429 on one model is retried at once
 * on the other instead of waiting out the window.
 *
 * @param {object} options
 * @param {string} options.systemPrompt - System instruction for the model
 * @param {string} options.userMessage  - The user's message
 * @param {boolean} [options.json=true] - Whether to parse response as JSON
 * @param {'primary'|'secondary'} [options.lane='primary'] - Which model to prefer.
 *   Latency-critical extraction uses 'primary'; background/secondary work
 *   ('secondary') starts on the other model so it doesn't eat the primary's quota.
 */
export async function chat({ systemPrompt, userMessage, json = true, lane = 'primary' }) {
  const preferred = lane === 'secondary' && activeModel !== FALLBACK_MODEL ? FALLBACK_MODEL : activeModel;
  const other     = preferred === FALLBACK_MODEL ? activeModel : FALLBACK_MODEL;

  try {
    return await complete(preferred, { systemPrompt, userMessage, json });
  } catch (err) {
    if (isModelUnavailable(err) && preferred === activeModel && activeModel !== FALLBACK_MODEL) {
      console.error(`[LLM] Model "${activeModel}" unavailable (${err.status}) — switching to fallback "${FALLBACK_MODEL}"`);
      activeModel = FALLBACK_MODEL;
      return complete(activeModel, { systemPrompt, userMessage, json });
    }
    if (err?.status === 429 && other !== preferred) {
      console.warn(`[LLM] Rate limited on "${preferred}" — retrying on "${other}"`);
      return complete(other, { systemPrompt, userMessage, json });
    }
    throw err;
  }
}

async function complete(model, { systemPrompt, userMessage, json }) {
  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
    temperature: 0.2, // Low temp for consistent extraction
  };

  // Reasoning models spend output tokens (and rate-limit budget) thinking — keep it minimal
  if (/gpt-oss/i.test(model)) requestBody.reasoning_effort = 'low';

  if (json) {
    // Groq supports JSON mode for compatible models
    requestBody.response_format = { type: 'json_object' };
  }

  const res = await groq.chat.completions.create(requestBody);
  const content = res.choices[0]?.message?.content ?? '';

  return json ? parseJsonContent(content) : stripReasoning(content);
}

/**
 * Parse a model's JSON reply, tolerating <think> blocks, markdown fences,
 * and stray prose around the object.
 */
export function parseJsonContent(content) {
  const clean = stripReasoning(content)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(clean);
  } catch (err) {
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw err;
  }
}

function stripReasoning(content) {
  return String(content).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function isModelUnavailable(err) {
  return err?.status === 404 ||
    (err?.status === 400 && /model/i.test(err?.message || '') && /decommission|not exist|not found|not supported/i.test(err?.message || ''));
}

/**
 * Whether retrying the same request could succeed.
 * Auth errors, bad requests and missing models never fix themselves — fail fast.
 */
export function isRetryableLLMError(err) {
  if (err instanceof SyntaxError) return true; // malformed JSON from the model — a re-roll usually fixes it
  const status = err?.status;
  if (!status) return true;                    // network error / timeout
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** How long the provider asked us to wait (ms), if it said. */
export function retryAfterMs(err) {
  const header = err?.headers?.['retry-after'] ?? err?.headers?.get?.('retry-after');
  const secs = Number(header);
  if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  const m = /try again in ([\d.]+)(ms|s)/i.exec(err?.message || '');
  if (m) return Number(m[1]) * (m[2].toLowerCase() === 's' ? 1000 : 1);
  return null;
}
