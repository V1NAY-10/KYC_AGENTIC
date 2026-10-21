import { verhoeffValid } from '../tools/aadhaarValidation.tool.js';

/**
 * Deterministic PAN / Aadhaar detection in a spoken transcript.
 *
 * Speech-to-text renders IDs in many shapes — "ABCDE1234F", "A B C D E 1 2 3 4 F",
 * "2345 6789 0124", "two three four five ...", "double four", Devanagari digits.
 * Regex on the normalized token stream is faster and more reliable than an LLM
 * for these, so the IdentityAgent tries this first and only falls back to the LLM
 * when nothing is found.
 */

const PAN_REGEX     = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_REGEX = /^[2-9][0-9]{11}$/;

const NUMBER_WORDS = {
  ZERO: '0', OH: '0', ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5',
  SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9',
  // Hindi (romanized, as Whisper often emits for Hinglish). "do" (2) is omitted —
  // it collides with English "do" far more often than it appears inside an ID.
  SHUNYA: '0', EK: '1', TEEN: '3', CHAAR: '4', CHAR: '4', PAANCH: '5',
  CHHE: '6', SAAT: '7', AATH: '8', NAU: '9',
};
const REPEATERS = { DOUBLE: 2, TRIPLE: 3 };

const DEVANAGARI_DIGITS = /[०-९]/g;

function tokenize(transcript) {
  const ascii = String(transcript || '')
    .replace(DEVANAGARI_DIGITS, d => String(d.charCodeAt(0) - 0x0966));

  const raw = ascii.toUpperCase().split(/[\s,.\-:;'"()/]+/).filter(Boolean);

  const tokens = [];
  for (let i = 0; i < raw.length; i++) {
    const word = raw[i];
    const repeat = REPEATERS[word];
    if (repeat && i + 1 < raw.length) {
      const next = NUMBER_WORDS[raw[i + 1]] ?? raw[i + 1];
      if (/^[0-9A-Z]$/.test(next)) {
        tokens.push(next.repeat(repeat));
        i++;
        continue;
      }
    }
    tokens.push(NUMBER_WORDS[word] ?? word);
  }
  return tokens;
}

/**
 * Mask any 12-digit (Aadhaar-shaped) number in free text before it is stored,
 * logged or sent to an LLM — only the last 4 digits survive.
 */
export function redactAadhaar(text) {
  return String(text ?? '').replace(/(?<!\d)((?:\d[\s-]?){8})((?:\d[\s-]?){3}\d)(?!\d)/g, (_m, _head, tail) => {
    const last4 = tail.replace(/\D/g, '');
    return `XXXX XXXX ${last4}`;
  });
}

/**
 * @param {string} transcript
 * @returns {{ pan: string|null, aadhaar: string|null, invalidAadhaar: string|null }}
 *   pan/aadhaar — first valid candidate found (raw, unmasked)
 *   invalidAadhaar — a 12-digit candidate that failed checksum (for a precise re-ask)
 */
export function findGovtIds(transcript) {
  const tokens = tokenize(transcript);
  let pan = null;
  let aadhaar = null;
  let invalidAadhaar = null;

  for (let i = 0; i < tokens.length; i++) {
    let joined = '';
    for (let j = i; j < tokens.length && joined.length < 12; j++) {
      joined += tokens[j];
      if (!pan && PAN_REGEX.test(joined)) pan = joined;
      if (AADHAAR_REGEX.test(joined)) {
        if (verhoeffValid(joined)) aadhaar = aadhaar || joined;
        else invalidAadhaar = invalidAadhaar || joined;
      }
    }
  }

  return { pan, aadhaar, invalidAadhaar };
}
