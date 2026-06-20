import { BaseAgent } from './base/BaseAgent.js';

/**
 * IdentityAgent
 *
 * Extracts and validates KYC field values from a user's transcript.
 * Also detects if the user volunteered values for OTHER fields in the same answer.
 *
 * Key capabilities vs. old callOrchestrator:
 *   - Runs PAN validation via the tool registry (not inline)
 *   - Validates age (18–80) on dateOfBirth
 *   - Detects multi-field answers (e.g., "I earn 50k at TCS" → income + employer)
 *   - Returns probeRequired + probeReason for any unclear/invalid response
 *
 * Input:  transcript, targetField, collectedFields, language, [sessionId]
 * Output: { extractedValue, confidence, isValid, validationNote, allExtracted, probeRequired, probeReason }
 */
export class IdentityAgent extends BaseAgent {
  constructor() {
    super('IdentityAgent');
  }

  async run({ transcript, targetField, collectedFields = {}, language = 'en', sessionId }) {
    const meta = this.semanticMemory.getFieldMeta(targetField);

    const systemPrompt = `You are a KYC data extraction specialist.

Extract ALL KYC field values you can find in the user's response.
Primary target field: "${targetField}" (${meta.label})

Already collected (reference only — do NOT re-extract unless user explicitly corrected):
${JSON.stringify(collectedFields, null, 2)}

Return ONLY valid JSON:
{
  "primaryExtraction": {
    "field": "${targetField}",
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
- Monetary values → number only (e.g., "₹50,000" or "50k" → 50000)
- Employment tenure → decimal years (e.g., "18 months" → 1.5, "2 years" → 2)
- Loan tenure → months (e.g., "3 years" → 36)
- confidence: 0.95 = very clear statement, 0.80 = strong inference, 0.60 = uncertain guess
- If unclear or ambiguous → probeRequired: true, probeReason: "specific reason"
- valid additionalExtractions fieldKeys: fullName, dateOfBirth, currentAddress, panNumber, monthlyIncome, employerName, employmentYears, existingEMI, loanAmount, loanPurpose, loanTenure`;

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
        extractedValue: null, confidence: 0, isValid: false,
        probeRequired: true, probeReason: 'Could not process your response',
        allExtracted: [], validationNote: null,
      };
    }

    const primary        = result.primaryExtraction || {};
    let extractedValue   = primary.value ?? null;
    let confidence       = primary.confidence ?? 0;
    let isValid          = true;
    let validationNote   = null;

    // ── Post-extraction validation per field type ─────────────────────────────
    if (targetField === 'panNumber' && extractedValue) {
      try {
        const panResult = await this.useTool('validate_pan', { pan: extractedValue }, sessionId);
        if (panResult.valid) {
          extractedValue = panResult.cleaned; // Use normalized form
          validationNote = panResult.message;
        } else {
          isValid = false;
          validationNote = panResult.message;
          confidence = Math.min(confidence, 0.30);
        }
      } catch (e) {
        this.log('warn', 'PAN validation tool failed', { sessionId, error: e.message });
      }
    }

    if (targetField === 'dateOfBirth' && extractedValue) {
      const ageCheck = this._validateAge(extractedValue);
      if (!ageCheck.valid) {
        isValid = false;
        validationNote = ageCheck.reason;
        confidence = Math.min(confidence, 0.20);
      } else {
        validationNote = `Age: ${ageCheck.age} years`;
      }
    }

    if (targetField === 'monthlyIncome' && extractedValue) {
      const income = parseFloat(extractedValue);
      if (!isNaN(income) && income > 10_000_000) { // > ₹1 crore/month → suspicious
        validationNote = 'Income value unusually high — may require verification';
        confidence = Math.min(confidence, 0.50);
      }
    }

    // ── Filter bonus extractions (high-quality only) ──────────────────────────
    const allExtracted = (result.additionalExtractions || [])
      .filter(e => e.field && e.value !== null && e.value !== undefined && e.confidence >= 0.70)
      .filter(e => e.field !== targetField); // Don't double-count primary

    const shouldProbe = result.probeRequired || !isValid || confidence < 0.60;

    this.log('info', 'Field extracted', {
      sessionId, targetField,
      confidence: confidence.toFixed(2),
      isValid,
      bonusFields: allExtracted.map(e => e.field),
    });

    return {
      extractedValue,
      confidence,
      isValid,
      validationNote,
      allExtracted,
      probeRequired: shouldProbe,
      probeReason: result.probeReason || validationNote,
    };
  }

  _validateAge(dob) {
    try {
      // Parse DD/MM/YYYY
      const parts = String(dob).split('/');
      if (parts.length !== 3) return { valid: true };
      const [day, month, year] = parts.map(Number);
      const birthDate = new Date(year, month - 1, day);
      const today     = new Date();
      const age       = today.getFullYear() - birthDate.getFullYear()
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
