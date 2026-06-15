import OpenAI from 'openai';

export const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
});

// Using a fast, reliable model on Groq
export const MODEL_NAME = 'llama-3.3-70b-versatile';
