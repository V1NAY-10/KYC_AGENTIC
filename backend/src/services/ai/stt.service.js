import { groq } from '../../config/llm.js';
import { toFile } from 'openai';
import { redactAadhaar } from '../../utils/govtIdParser.js';

const EXTENSIONS = {
  'audio/webm': 'webm',
  'audio/ogg':  'ogg',
  'audio/mp4':  'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav':  'wav',
};

// Biases Whisper towards how KYC answers should be written (IDs as compact tokens)
const VOCAB_PROMPT = {
  en: 'KYC loan interview. PAN number like ABCDE1234F. Aadhaar number like 2345 6789 0124. Amounts in rupees, e.g. 50,000.',
  hi: 'KYC लोन इंटरव्यू। PAN नंबर जैसे ABCDE1234F। आधार नंबर जैसे 2345 6789 0124। राशि रुपये में।',
};

// Phrases Whisper is known to hallucinate on silent / near-silent audio
const HALLUCINATIONS = new Set([
  'you', 'thank you', 'thank you.', 'thanks for watching', 'thanks for watching!',
  'thank you for watching', 'thank you for watching.', 'bye', 'bye.', '.', '...',
  'please subscribe', 'subtitles by the amara.org community', 'धन्यवाद', 'धन्यवाद।',
]);

/**
 * Transcribes an audio buffer using Groq's Whisper API.
 *
 * @param {Buffer} audioBuffer - The raw binary audio data
 * @param {string} language - The language key ('en' | 'hi')
 * @param {string} [mimeType] - Recorder mime type (Safari records audio/mp4, not webm)
 * @returns {Promise<string>} The transcribed text ('' for silence)
 */
export async function transcribeAudio(audioBuffer, language, mimeType = 'audio/webm') {
  if (!audioBuffer || audioBuffer.length === 0) {
    console.warn('[STT] Empty audio buffer received');
    return '';
  }

  const baseType = String(mimeType).split(';')[0].trim().toLowerCase();
  const ext      = EXTENSIONS[baseType] || 'webm';
  const lang     = language === 'hi' ? 'hi' : 'en';

  console.log(`[STT] Sending audio buffer (${audioBuffer.length} bytes, ${baseType}) to Groq Whisper...`);

  const file = await toFile(audioBuffer, `audio.${ext}`, { type: baseType || 'audio/webm' });

  const response = await groq.audio.transcriptions.create({
    file,
    model:       process.env.GROQ_STT_MODEL || 'whisper-large-v3',
    language:    lang,
    prompt:      VOCAB_PROMPT[lang],
    temperature: 0,
  });

  const text = (response.text || '').trim();
  console.log(`[STT] Transcription response: "${redactAadhaar(text)}"`);

  if (HALLUCINATIONS.has(text.toLowerCase()) || text === VOCAB_PROMPT[lang]) {
    console.warn('[STT] Discarding likely silence hallucination');
    return '';
  }
  return text;
}
