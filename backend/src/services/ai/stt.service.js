import { groq } from '../../config/llm.js';
import { toFile } from 'openai';

/**
 * Transcribes an audio buffer using Groq's Whisper API.
 * 
 * @param {Buffer} audioBuffer - The raw binary audio data
 * @param {string} language - The language key ('en' | 'hi')
 * @returns {Promise<string>} The transcribed text response
 */
export async function transcribeAudio(audioBuffer, language) {
  try {
    if (!audioBuffer || audioBuffer.length === 0) {
      console.warn('[STT] Empty audio buffer received');
      return '';
    }

    console.log(`[STT] Sending audio buffer (${audioBuffer.length} bytes) to Groq Whisper...`);
    
    // Convert the buffer to a File object expected by the SDK
    const file = await toFile(audioBuffer, 'audio.webm', { type: 'audio/webm' });
    
    const response = await groq.audio.transcriptions.create({
      file: file,
      model: 'whisper-large-v3',
      language: language === 'hi' ? 'hi' : 'en',
    });

    console.log(`[STT] Transcription response: "${response.text}"`);
    return response.text || '';
  } catch (error) {
    console.error('[STT] Transcription error:', error);
    throw error;
  }
}
