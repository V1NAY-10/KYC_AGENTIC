/**
 * Prompt injection detection for user audio transcripts.
 *
 * Called BEFORE any LLM receives user input.
 * If injection is detected: the Planner logs a fraud signal and
 * replays the last question without escalating.
 */

// Definite injection patterns — should never appear in a genuine KYC answer
const INJECTION_PATTERNS = [
  /ignore\s+(previous|above|prior|all)\s+(instructions?|prompts?|rules?|context)/i,
  /you\s+are\s+now\s+/i,
  /disregard\s+(all\s+)?(previous\s+)?(instructions?|context)/i,
  /\bDAN\b/,
  /act\s+as\s+(if\s+you\s+(are|were)|a\s+)/i,
  /override\s+(your\s+)?(instructions?|rules?|guidelines?|system)/i,
  /forget\s+(everything|all|your\s+(previous|instructions?))/i,
  /system\s+prompt/i,
  /jailbreak/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /new\s+persona/i,
  /developer\s+mode/i,
];

// Suspicious but not definitive — lower severity
const SUSPICIOUS_PATTERNS = [
  /[<>{}\[\]]{4,}/,           // Many special chars (possible encoded payload)
  /base64|eval\s*\(|exec\s*\(/i,
  /(script|iframe|onclick)/i, // HTML/JS injection attempt
];

/**
 * Checks a user transcript for prompt injection.
 *
 * @param {string} text
 * @returns {{ safe: boolean, reason?: string, description?: string, severity?: string }}
 */
export function detectPromptInjection(text) {
  if (!text || typeof text !== 'string') return { safe: true };

  // Hard injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: false,
        reason: 'PROMPT_INJECTION_DETECTED',
        description: 'Potential prompt injection attempt detected in user input.',
        severity: 'high',
      };
    }
  }

  // Suspicious patterns (lower severity)
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: false,
        reason: 'SUSPICIOUS_PAYLOAD_DETECTED',
        description: 'Suspicious encoded or script-like content in input.',
        severity: 'medium',
      };
    }
  }

  // Length check — genuine KYC answers are short
  if (text.length > 800) {
    return {
      safe: false,
      reason: 'UNUSUALLY_LONG_INPUT',
      description: `Input length ${text.length} chars far exceeds typical KYC answer.`,
      severity: 'low',
    };
  }

  return { safe: true };
}
