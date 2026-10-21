import OpenAI from 'openai';

export const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
  timeout: Number(process.env.LLM_TIMEOUT_MS) || 15_000,
  maxRetries: 0, // BaseAgent owns retries — SDK retries on top of those multiplied every failure ×3
});

// Using a fast, reliable model on Groq (llama-3.3-70b-versatile was retired by Groq).
// Override with GROQ_MODEL env var if this one is deprecated too.
export const MODEL_NAME = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

// Used automatically if the primary model is retired / not available to this key
export const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b';
