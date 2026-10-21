/**
 * Aadhaar Validation Tool
 *
 * Validates an Indian Aadhaar number (12 digits, UIDAI Verhoeff checksum).
 * Format: 12 digits, first digit 2–9 — e.g., 2345 6789 0124
 *
 * 100% local — no external API needed.
 *
 * Privacy: Aadhaar Act §29 restricts storing full Aadhaar numbers outside an
 * Aadhaar Data Vault, so only the MASKED form (XXXX XXXX 1234) leaves this tool
 * as the value to persist.
 */

// Verhoeff tables (dihedral group D5)
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits) {
  let c = 0;
  const reversed = String(digits).split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[i % 8][reversed[i]]];
  }
  return c === 0;
}

export function maskAadhaar(digits) {
  return `XXXX XXXX ${String(digits).slice(-4)}`;
}

// Already-masked value (e.g. from the review page) — accepted as previously validated
const MASKED_REGEX = /^X{4}\s?X{4}\s?\d{4}$/i;

export const aadhaarValidationTool = {
  name: 'validate_aadhaar',
  description: 'Validates an Indian Aadhaar number (12 digits + Verhoeff checksum). Returns validity and a masked value safe to store.',
  parameters: {
    aadhaar: { type: 'string', description: 'Aadhaar number string to validate (e.g., 2345 6789 0124)' },
  },

  execute: async ({ aadhaar }) => {
    if (!aadhaar || typeof aadhaar !== 'string') {
      return { valid: false, format: 'missing', message: 'No Aadhaar number provided', masked: null };
    }

    const trimmed = aadhaar.trim();
    if (MASKED_REGEX.test(trimmed)) {
      return { valid: true, format: 'masked', masked: maskAadhaar(trimmed), message: 'Previously verified Aadhaar (masked)' };
    }

    const cleaned = trimmed.replace(/[\s\-.]/g, '');

    if (!/^\d{12}$/.test(cleaned)) {
      return {
        valid: false,
        format: 'malformed',
        masked: null,
        message: `Aadhaar must be exactly 12 digits, got ${cleaned.replace(/\D/g, '').length}`,
      };
    }

    if (/^[01]/.test(cleaned)) {
      return { valid: false, format: 'malformed', masked: null, message: 'Aadhaar numbers never start with 0 or 1' };
    }

    if (!verhoeffValid(cleaned)) {
      return { valid: false, format: 'checksum', masked: null, message: 'Aadhaar checksum failed — a digit may have been misheard' };
    }

    return {
      valid: true,
      format: 'correct',
      masked: maskAadhaar(cleaned),
      message: 'Valid Aadhaar number',
    };
  },
};
