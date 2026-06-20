/**
 * PAN Validation Tool
 *
 * Validates an Indian Permanent Account Number (PAN) format.
 * Format: [A-Z]{5}[0-9]{4}[A-Z]{1} — e.g., ABCDE1234F
 *
 * 100% local — no external API needed. Completely free.
 *
 * The 4th character (index 3) encodes entity type:
 *   P = Individual, C = Company, H = HUF, F = Firm, A = AOP, etc.
 */

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

const ENTITY_TYPES = {
  P: 'Individual',
  C: 'Company',
  H: 'HUF (Hindu Undivided Family)',
  F: 'Firm',
  A: 'Association of Persons (AOP)',
  T: 'Trust',
  B: 'Body of Individuals (BOI)',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government',
};

export const panValidationTool = {
  name: 'validate_pan',
  description: 'Validates an Indian PAN number format. Returns validity, entity type, and cleaned value.',
  parameters: {
    pan: { type: 'string', description: 'PAN number string to validate (e.g., ABCDE1234F)' },
  },

  execute: async ({ pan }) => {
    if (!pan || typeof pan !== 'string') {
      return { valid: false, format: 'missing', message: 'No PAN number provided', cleaned: null };
    }

    // Normalize: uppercase, strip spaces/hyphens
    const cleaned = pan.toUpperCase().trim().replace(/[\s\-]/g, '');

    if (!PAN_REGEX.test(cleaned)) {
      return {
        valid: false,
        format: 'malformed',
        cleaned,
        message: `Invalid PAN format. Expected XXXXX9999X (e.g., ABCDE1234F), got: ${cleaned}`,
        entityType: null,
      };
    }

    const typeChar = cleaned[3];
    const entityType = ENTITY_TYPES[typeChar] || 'Unknown Entity';

    return {
      valid: true,
      format: 'correct',
      cleaned,
      entityType,
      message: `Valid PAN format — Entity type: ${entityType}`,
    };
  },
};
