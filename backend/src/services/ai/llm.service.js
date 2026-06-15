import { groq, MODEL_NAME } from '../../config/llm.js';

/**
 * Generic chat function — all AI calls go through here.
 * Uses Groq via the OpenAI-compatible SDK.
 *
 * @param {object} options
 * @param {string} options.systemPrompt - System instruction for the model
 * @param {string} options.userMessage  - The user's message
 * @param {boolean} [options.json=true] - Whether to parse response as JSON
 */
export async function chat({ systemPrompt, userMessage, json = true }) {
  const requestBody = {
    model: MODEL_NAME,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
    temperature: 0.2, // Low temp for consistent extraction
  };

  if (json) {
    // Groq supports JSON mode for compatible models
    requestBody.response_format = { type: 'json_object' };
  }

  const res = await groq.chat.completions.create(requestBody);
  const content = res.choices[0].message.content;

  if (json) {
    // Strip any accidental markdown fences the LLM might add
    const clean = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(clean);
  }

  return content;
}
