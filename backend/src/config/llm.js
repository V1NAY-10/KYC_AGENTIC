import OpenAI from 'openai';

export const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
});

// Using a fast, reliable model on Groq (llama-3.3-70b-versatile was retired by Groq).
// Override with GROQ_MODEL env var if this one is deprecated too.
export const MODEL_NAME = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
