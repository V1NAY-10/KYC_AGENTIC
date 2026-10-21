import { BaseAgent } from './base/BaseAgent.js';
import { findGovtIds } from '../utils/govtIdParser.js';

const ID_FIELDS = new Set(['govtId', 'panNumber', 'aadhaarNumber']);
const NULLISH_STRINGS = new Set(['', 'null', 'none', 'n/a', 'na', 'unknown', 'undefined']);
const NO_EMI_REGEX = /^\W*(no|nope|none|nil|zero|nothing|not really|i don'?t|i do not|i have no|there (is|are) no|नहीं|कोई नहीं)(?![a-z])/i;

/**
 * IdentityAgent
 *
 * Extracts and validates KYC field values from a user's transcript.
 * Also detects if the user volunteered values for OTHER fields in the same answer.
 *
 * Key capabilities vs. old callOrchestrator:
 *   - PAN / Aadhaar: deterministic parse first (no LLM round-trip), validated via tools
 *   - govtId requirement accepts EITHER a PAN or an Aadhaar number
 *   - Validates age (18–80) on dateOfBirth
 *   - Detects multi-field answers (e.g., "I earn 50k at TCS" → income + employer)
 *   - Every volunteered field goes through the same validation as the primary one
 *   - Returns probeRequired + probeReason for any unclear/invalid response
 *
 * Input:  transcript, targetField, collectedFields, language, [sessionId]
 * Output: { extractedField, extractedValue, confidence, isValid, validationNote, allExtracted, probeRequired, probeReason }
 *   extractedField — the concrete field the value belongs to (targetField 'govtId' → 'panNumber' | 'aadhaarNumber')
 */
export class IdentityAgent extends BaseAgent {
  constructor() {
    super('IdentityAgent');
  }

  async run({ transcript, targetField, collectedFields = {}, language = 'en', sessionId }) {
    if (ID_FIELDS.has(targetField)) {
      const fast = await this._extractGovtIdDeterministic(transcript, targetField, sessionId);
      if (fast) return fast;
    }

    // "No EMI" is the most common answer to that question — no LLM needed
    if (targetField === 'existingEMI' && NO_EMI_REGEX.test(transcript) && !/\d/.test(transcript)) {
      return {
        extractedField: 'existingEMI', extractedValue: 0, confidence: 0.92, isValid: true,
        validationNote: null, allExtracted: [], probeRequired: false, probeReason: null,
      };
    }

    const meta = this.semanticMemory.getFieldMeta(targetField);
    const extractable = this.semanticMemory.getExtractableFieldKeys();
    const primaryFieldHint = targetField === 'govtId'
      ? `"panNumber" if the user gave a PAN, or "aadhaarNumber" if they gave an Aadhaar number`
      : `"${targetField}"`;

    const systemPrompt = `You are a KYC data extraction specialist.

Extract ALL KYC field values you can find in the user's response.
Primary target: "${targetField}" (${meta.label})

Already collected (do NOT re-extract unless the user explicitly corrects one): ${Object.keys(collectedFields).join(', ') || 'none'}

Return ONLY valid JSON:
{
  "primaryExtraction": {
    "field": ${primaryFieldHint},
    "value": "extracted value or null",
    "confidence": 0.0,
    "rawMention": "exact words user used"
  },
  "additionalExtractions": [
    { "field": "fieldKey", "value": "extracted value", "confidence": 0.0 }
  ],
  "probeRequired": false,
  "probeReason": null
}

EXTRACTION RULES:
- Dates → DD/MM/YYYY (e.g., "15th January 1990" → "15/01/1990")
- PAN → uppercase, no spaces (e.g., "abcde 1234 f" → "ABCDE1234F")
- Aadhaar → 12 digits, no spaces (e.g., "2345 6789 0124" → "234567890124")
- The user only needs ONE of PAN or Aadhaar. If they say they don't have a PAN, that is fine — ask for Aadhaar instead (probeReason).
- Monetary values → number only (e.g., "₹50,000" or "50k" → 50000)
- "No EMI" / "no loans" for existingEMI → 0
- Employment tenure → decimal years (e.g., "18 months" → 1.5, "2 years" → 2)
- Loan tenure → months (e.g., "3 years" → 36)
- confidence: 0.95 = very clear statement, 0.80 = strong inference, 0.60 = uncertain guess
- If unclear or ambiguous → value null, probeRequired: true, probeReason: "specific reason"
- valid fieldKeys: ${extractable.join(', ')}`;

    let result;
    try {
      result = await this.callLLM({
        systemPrompt,
        userMessage: `User said: "${transcript}"`,
        json: true,
      });
    } catch (err) {
      this.log('error', 'LLM extraction failed', { sessionId, targetField, error: err.message });
      return {
        extractedField: targetField, extractedValue: null, confidence: 0, isValid: false,
        probeRequired: true, probeReason: 'Could not process your response',
        allExtracted: [], validationNote: null,
      };
    }

    const primary = result?.primaryExtraction || {};
    let extractedField = this._resolvePrimaryField(targetField, primary.field);
    let extractedValue = this._clean(primary.value);
    let confidence     = this._confidence(primary.confidence);
    let isValid        = true;
    let validationNote = null;

    if (extractedValue !== null) {
      const check = await this._validateField(extractedField, extractedValue, sessionId);
      extractedValue = check.value;
      isValid        = check.isValid;
      validationNote = check.note;
      if (check.confidenceCap !== undefined) confidence = Math.min(confidence, check.confidenceCap);
    }

    // ── Bonus extractions: validate exactly like the primary ──────────────────
    const allExtracted = [];
    for (const e of (result?.additionalExtractions || [])) {
      const value = this._clean(e?.value);
      const conf  = this._confidence(e?.confidence);
      if (!e?.field || value === null || conf < 0.70) continue;
      if (e.field === extractedField || !extractable.includes(e.field)) continue;

      const check = await this._validateField(e.field, value, sessionId);
      if (!check.isValid) continue;
      allExtracted.push({ field: e.field, value: check.value, confidence: conf });
    }

    const shouldProbe = Boolean(result?.probeRequired) || !isValid || extractedValue === null || confidence < 0.60;

    this.log('info', 'Field extracted', {
      sessionId, targetField, extractedField,
      confidence: confidence.toFixed(2),
      isValid,
      bonusFields: allExtracted.map(e => e.field),
    });

    return {
      extractedField,
      extractedValue,
      confidence,
      isValid,
      validationNote,
      allExtracted,
      probeRequired: shouldProbe,
      probeReason: result?.probeReason || validationNote,
    };
  }

  // ── PAN / Aadhaar without an LLM call ──────────────────────────────────────
  async _extractGovtIdDeterministic(transcript, targetField, sessionId) {
    const { pan, aadhaar, invalidAadhaar } = findGovtIds(transcript);

    const wantPan     = targetField !== 'aadhaarNumber';
    const wantAadhaar = targetField !== 'panNumber';
    const found = [];
    if (pan && wantPan)         found.push({ field: 'panNumber', value: pan });
    if (aadhaar && wantAadhaar) found.push({ field: 'aadhaarNumber', value: aadhaar });

    if (found.length === 0) {
      if (invalidAadhaar && wantAadhaar) {
        return {
          extractedField: 'aadhaarNumber', extractedValue: null, confidence: 0, isValid: false,
          validationNote: 'Aadhaar checksum failed', allExtracted: [], probeRequired: true,
          probeReason: 'That Aadhaar number did not pass verification — a digit may have been misheard. Ask them to read it again slowly, four digits at a time.',
        };
      }
      return null; // nothing recognisable — let the LLM interpret (e.g. "I don't have a PAN")
    }

    const validated = [];
    for (const f of found) {
      const check = await this._validateField(f.field, f.value, sessionId);
      if (check.isValid) validated.push({ field: f.field, value: check.value, confidence: 0.97, note: check.note });
    }
    if (validated.length === 0) return null;

    const [primary, ...rest] = validated;
    this.log('info', 'Govt ID parsed deterministically', { sessionId, fields: validated.map(v => v.field) });

    return {
      extractedField: primary.field,
      extractedValue: primary.value,
      confidence:     primary.confidence,
      isValid:        true,
      validationNote: primary.note,
      allExtracted:   rest.map(({ field, value, confidence }) => ({ field, value, confidence })),
      probeRequired:  false,
      probeReason:    null,
    };
  }

  /**
   * Field-specific validation. Returns the normalized value to store.
   * @returns {{ value, isValid: boolean, note: string|null, confidenceCap?: number }}
   */
  async _validateField(field, value, sessionId) {
    if (field === 'panNumber') {
      try {
        const res = await this.useTool('validate_pan', { pan: String(value) }, sessionId);
        return res.valid
          ? { value: res.cleaned, isValid: true, note: res.message }
          : { value, isValid: false, note: res.message, confidenceCap: 0.30 };
      } catch (e) {
        this.log('warn', 'PAN validation tool failed', { sessionId, error: e.message });
        return { value, isValid: false, note: 'PAN could not be validated', confidenceCap: 0.30 };
      }
    }

    if (field === 'aadhaarNumber') {
      try {
        const res = await this.useTool('validate_aadhaar', { aadhaar: String(value) }, sessionId);
        return res.valid
          ? { value: res.masked, isValid: true, note: res.message }
          : { value: null, isValid: false, note: res.message, confidenceCap: 0.30 };
      } catch (e) {
        this.log('warn', 'Aadhaar validation tool failed', { sessionId, error: e.message });
        return { value: null, isValid: false, note: 'Aadhaar could not be validated', confidenceCap: 0.30 };
      }
    }

    if (field === 'dateOfBirth') {
      const ageCheck = this._validateAge(value);
      return ageCheck.valid
        ? { value, isValid: true, note: ageCheck.age !== undefined ? `Age: ${ageCheck.age} years` : null }
        : { value, isValid: false, note: ageCheck.reason, confidenceCap: 0.20 };
    }

    if (field === 'monthlyIncome') {
      const income = parseFloat(value);
      if (!isNaN(income) && income > 10_000_000) { // > ₹1 crore/month → suspicious
        return { value, isValid: true, note: 'Income value unusually high — may require verification', confidenceCap: 0.50 };
      }
    }

    return { value, isValid: true, note: null };
  }

  _resolvePrimaryField(targetField, reportedField) {
    if (targetField !== 'govtId') return targetField;
    return reportedField === 'aadhaarNumber' ? 'aadhaarNumber' : 'panNumber';
  }

  _clean(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && NULLISH_STRINGS.has(value.trim().toLowerCase())) return null;
    return value;
  }

  _confidence(raw) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  }

  _validateAge(dob) {
    try {
      // Parse DD/MM/YYYY
      const parts = String(dob).split('/');
      if (parts.length !== 3) return { valid: true };
      const [day, month, year] = parts.map(Number);
      if (!day || !month || !year || month > 12 || day > 31) {
        return { valid: false, reason: 'Date of birth is not a valid calendar date' };
      }
      const today     = new Date();
      const age       = today.getFullYear() - year
                        - (today < new Date(today.getFullYear(), month - 1, day) ? 1 : 0);

      if (year > today.getFullYear())  return { valid: false, reason: 'Date of birth cannot be in the future' };
      if (age < 18) return { valid: false, reason: `Minimum age is 18 years (calculated: ${age})` };
      if (age > 80) return { valid: false, reason: `Age ${age} seems very high — please verify date of birth` };

      return { valid: true, age };
    } catch {
      return { valid: true }; // Can't parse → let it through, flag later
    }
  }
}
