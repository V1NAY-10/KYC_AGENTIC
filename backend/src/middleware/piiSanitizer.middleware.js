// ─── PII Patterns ─────────────────────────────────────────────────────────────
const PAN_REGEX    = /[A-Z]{5}[0-9]{4}[A-Z]/g;
const DOB_REGEX    = /\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/g;
const PHONE_REGEX  = /[6-9]\d{9}/g;
const EMAIL_REGEX  = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Fields whose values should always be masked regardless of content
const SENSITIVE_KEYS = new Set([
  'panNumber', 'pan', 'dateOfBirth', 'dob', 'phone', 'mobile',
  'email', 'currentAddress', 'address', 'signedName',
]);

/**
 * Mask PII patterns in a string.
 */
function maskString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(PAN_REGEX,   (m) => `${m.slice(0, 3)}****${m.slice(-1)}`)
    .replace(DOB_REGEX,   (m) => `****-**-${m.slice(-2)}`)
    .replace(PHONE_REGEX, (m) => `${m.slice(0, 2)}*****${m.slice(-3)}`)
    .replace(EMAIL_REGEX, (m) => {
      const [local, domain] = m.split('@');
      return `${local.slice(0, 2)}***@${domain}`;
    });
}

/**
 * Deep-clone and sanitize any data structure, masking PII.
 * Safe to call on strings, arrays, objects, null.
 *
 * @param {*} data
 * @returns Sanitized copy of data
 */
export function sanitizePII(data) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  if (typeof data === 'string') return maskString(data);
  if (Array.isArray(data)) return data.map(sanitizePII);

  if (typeof data === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_KEYS.has(key) && typeof value === 'string') {
        result[key] = maskString(value) || '[REDACTED]';
      } else {
        result[key] = sanitizePII(value);
      }
    }
    return result;
  }

  return data;
}

/**
 * Express middleware — attaches a sanitized copy of req.body for safe logging.
 * Does NOT alter the original req.body.
 */
export const piiSanitizerMiddleware = (req, _res, next) => {
  if (req.body) {
    req._sanitizedBody = sanitizePII(req.body);
  }
  next();
};
