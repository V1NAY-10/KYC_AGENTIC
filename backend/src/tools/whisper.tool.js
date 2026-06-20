import { transcribeAudio } from '../services/ai/stt.service.js';

/**
 * Whisper Tool — wraps stt.service.js as a registered tool.
 *
 * Exposing STT as a tool means:
 *  1. All audio transcriptions are logged in ToolCallLog
 *  2. Agents can invoke it through the ToolRegistry interface
 *  3. Swapping Whisper for another STT model only changes this file
 */
export const whisperTool = {
  name: 'transcribe_audio',
  description: 'Transcribes a raw audio buffer to text using Groq Whisper (whisper-large-v3).',
  parameters: {
    audioBuffer: { type: 'object', description: 'Raw audio Buffer from the browser' },
    language:    { type: 'string', description: 'Language code: "en" for English, "hi" for Hindi' },
  },

  execute: async ({ audioBuffer, language }) => {
    const text = await transcribeAudio(audioBuffer, language);
    return { text, language };
  },
};
