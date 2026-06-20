import { chat } from './llm.service.js';

/**
 * Interview Summary Service
 *
 * Called async after call:complete — generates an AI intelligence report
 * for loan officers. Analyzes the full transcript, confidence map, fraud
 * signals, geo data, and turn count to produce actionable notes.
 *
 * Output is saved to Session.interviewSummary in MongoDB.
 */

/**
 * Generate an interview summary for a completed KYC session.
 *
 * @param {object} params
 * @param {Array}  params.transcript       - Full transcript [{role, text, timestamp}]
 * @param {object} params.collectedFields  - All extracted KYC fields
 * @param {object} params.confidenceMap    - Per-field confidence scores
 * @param {Array}  params.fraudSignals     - Fraud signals raised during session
 * @param {number} params.fraudScore       - Overall fraud score (0–100)
 * @param {object} params.geoData          - IP geolocation data
 * @param {number} params.turnCount        - Total conversation turns
 * @param {number} params.durationSeconds  - Call duration in seconds
 * @param {string} params.language         - 'en' | 'hi'
 * @returns {Promise<object>} Summary object to save in Session.interviewSummary
 */
export async function generateInterviewSummary({
  transcript = [],
  collectedFields = {},
  confidenceMap = {},
  fraudSignals = [],
  fraudScore = 0,
  geoData = {},
  turnCount = 0,
  durationSeconds = 0,
  language = 'en',
}) {
  try {
    // Build concise transcript snippet (last 20 turns max to fit context)
    const transcriptSnippet = transcript
      .slice(-20)
      .map(t => `${t.role === 'agent' ? 'ARIA' : 'USER'}: ${t.text}`)
      .join('\n');

    // Identify high vs low confidence fields
    const highConfidenceFields = Object.entries(confidenceMap)
      .filter(([, v]) => v >= 0.80)
      .map(([k]) => k);

    const lowConfidenceFields = Object.entries(confidenceMap)
      .filter(([, v]) => v < 0.70)
      .map(([k]) => k);

    // Fraud signal summary
    const fraudSummary = fraudSignals.length > 0
      ? fraudSignals.map(s => `${s.severity?.toUpperCase()} — ${s.description}`).join('; ')
      : 'No fraud signals detected';

    const systemPrompt = `You are an AI loan compliance analyst. Analyze this KYC video interview and produce a structured intelligence report for the loan officer.

INTERVIEW DATA:
- Language: ${language === 'hi' ? 'Hindi' : 'English'}
- Total turns: ${turnCount}
- Duration: ${Math.round(durationSeconds / 60)} minutes
- Fraud score: ${fraudScore}/100
- Fraud signals: ${fraudSummary}
- High-confidence fields: ${highConfidenceFields.join(', ') || 'none'}
- Low-confidence fields: ${lowConfidenceFields.join(', ') || 'none'}
- Applicant IP location: ${geoData.city || 'unknown'}, ${geoData.country || 'unknown'} | VPN: ${geoData.isVPN ? 'YES' : 'No'} | Proxy: ${geoData.isProxy ? 'YES' : 'No'}

COLLECTED FIELDS:
${JSON.stringify(collectedFields, null, 2)}

TRANSCRIPT (last 20 turns):
${transcriptSnippet || '(no transcript available)'}

INSTRUCTIONS:
Analyze the interview holistically. Return ONLY valid JSON with this exact structure:
{
  "overallTone": "cooperative" | "hesitant" | "evasive",
  "keyObservations": ["3-5 specific, factual observations about how the applicant answered"],
  "riskNotes": ["1-3 risk notes based on geo, fraud signals, or inconsistencies"],
  "recommendedAction": "one sentence recommendation for the loan officer"
}

Be specific and factual. Reference actual field values where relevant. Do NOT fabricate data.`;

    const result = await chat({
      systemPrompt,
      userMessage: 'Generate the interview intelligence report now.',
      json: true,
    });

    return {
      overallTone:          result.overallTone          || 'cooperative',
      totalTurns:           turnCount,
      durationSeconds:      durationSeconds,
      highConfidenceFields,
      lowConfidenceFields,
      keyObservations:      Array.isArray(result.keyObservations) ? result.keyObservations : [],
      riskNotes:            Array.isArray(result.riskNotes)       ? result.riskNotes       : [],
      recommendedAction:    result.recommendedAction    || 'Proceed with standard verification',
      generatedAt:          new Date(),
    };

  } catch (err) {
    console.error('[InterviewSummary] Generation failed:', err.message);
    // Return a safe fallback — never block the call completion flow
    return {
      overallTone:          'cooperative',
      totalTurns:           turnCount,
      durationSeconds:      durationSeconds,
      highConfidenceFields: [],
      lowConfidenceFields:  [],
      keyObservations:      ['Summary generation failed — manual review recommended'],
      riskNotes:            [],
      recommendedAction:    'Manual review required',
      generatedAt:          new Date(),
    };
  }
}
