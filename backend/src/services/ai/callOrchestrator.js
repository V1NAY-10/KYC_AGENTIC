import { chat } from './llm.service.js';

// ─── Agent States ─────────────────────────────────────────────────────────────
export const AGENT_STATES = {
  GREETING:              'GREETING',
  IDENTITY_NAME:         'IDENTITY_NAME',
  IDENTITY_DOB:          'IDENTITY_DOB',
  IDENTITY_ADDRESS:      'IDENTITY_ADDRESS',
  IDENTITY_PAN:          'IDENTITY_PAN',
  FINANCIAL_INCOME:      'FINANCIAL_INCOME',
  FINANCIAL_EMPLOYER:    'FINANCIAL_EMPLOYER',
  FINANCIAL_TENURE:      'FINANCIAL_TENURE',
  FINANCIAL_EXISTING_EMI:'FINANCIAL_EXISTING_EMI',
  LOAN_AMOUNT:           'LOAN_AMOUNT',
  LOAN_PURPOSE:          'LOAN_PURPOSE',
  LOAN_TENURE:           'LOAN_TENURE',
  DOCUMENT_VERIFY:       'DOCUMENT_VERIFY',
  CALL_COMPLETE:         'CALL_COMPLETE',
};

// State → next state map (linear flow; agent can override for probes)
const STATE_FLOW = {
  GREETING:               'IDENTITY_NAME',
  IDENTITY_NAME:          'IDENTITY_DOB',
  IDENTITY_DOB:           'IDENTITY_ADDRESS',
  IDENTITY_ADDRESS:       'IDENTITY_PAN',
  IDENTITY_PAN:           'FINANCIAL_INCOME',
  FINANCIAL_INCOME:       'FINANCIAL_EMPLOYER',
  FINANCIAL_EMPLOYER:     'FINANCIAL_TENURE',
  FINANCIAL_TENURE:       'FINANCIAL_EXISTING_EMI',
  FINANCIAL_EXISTING_EMI: 'LOAN_AMOUNT',
  LOAN_AMOUNT:            'LOAN_PURPOSE',
  LOAN_PURPOSE:           'LOAN_TENURE',
  LOAN_TENURE:            'DOCUMENT_VERIFY',
  DOCUMENT_VERIFY:        'CALL_COMPLETE',
  CALL_COMPLETE:          'CALL_COMPLETE',
};

// Field that each state is trying to collect
const STATE_FIELD = {
  IDENTITY_NAME:          'fullName',
  IDENTITY_DOB:           'dateOfBirth',
  IDENTITY_ADDRESS:       'currentAddress',
  IDENTITY_PAN:           'panNumber',
  FINANCIAL_INCOME:       'monthlyIncome',
  FINANCIAL_EMPLOYER:     'employerName',
  FINANCIAL_TENURE:       'employmentYears',
  FINANCIAL_EXISTING_EMI: 'existingEMI',
  LOAN_AMOUNT:            'loanAmount',
  LOAN_PURPOSE:           'loanPurpose',
  LOAN_TENURE:            'loanTenure',
};

// ─── System Prompt Builder ────────────────────────────────────────────────────
function buildSystemPrompt(language, currentState, collectedAnswers) {
  const lang = language === 'hi' ? 'Hindi' : 'English';
  const answersStr = JSON.stringify(collectedAnswers || {}, null, 2);
  const expectedField = STATE_FIELD[currentState] || 'general';

  return `You are Aria, a professional and empathetic loan onboarding assistant for a bank.
You are conducting a KYC video call with a personal loan applicant.

LANGUAGE: ${lang} — ALL your questions and responses MUST be in ${lang}.
CURRENT MODULE: ${currentState}
FIELD TO COLLECT: ${expectedField}
ANSWERS COLLECTED SO FAR: ${answersStr}

YOUR TASK FOR THIS TURN:
1. Analyze the user's latest answer
2. Extract the value for field: "${expectedField}"
3. Assess confidence (0.0–1.0) in what you extracted
4. Check for inconsistencies with prior answers — flag if found
5. Identify fraud signals: hesitation, contradiction, implausible values
6. Decide next state (use "${STATE_FLOW[currentState]}" unless a probe is needed)
7. Generate the next question in ${lang} — be conversational and friendly

IMPORTANT RULES:
- If the user's answer is unclear, set probeRequired: true and re-ask in simpler words
- If you detect a serious inconsistency, set fraudSignals with severity "high"
- Never skip collecting a field — always confirm before moving on
- Keep questions short and natural — avoid sounding like a form
- For DOCUMENT_VERIFY state: thank them and say the call is now complete, no question needed
- For the closing state, set nextState to "CALL_COMPLETE"

Return ONLY valid JSON (no markdown, no code fences):
{
  "extractedValue": "the extracted value or null",
  "confidence": 0.0,
  "fraudSignals": [],
  "inconsistency": null,
  "nextState": "${STATE_FLOW[currentState]}",
  "nextQuestion": "your next question here",
  "probeRequired": false
}`;
}

// ─── Greeting Generator ───────────────────────────────────────────────────────
export function getGreeting(language) {
  if (language === 'hi') {
    return 'नमस्ते! मैं Aria हूँ, आपकी लोन सहायक। आज मैं आपका KYC प्रक्रिया पूरी करने में मदद करूँगी। क्या आप अपना पूरा नाम बता सकते हैं?';
  }
  return "Hi! I'm Aria, your loan onboarding assistant. I'll be asking you a few questions to complete your KYC for a personal loan — it'll only take about 5 minutes. Let's start — could you please tell me your full name?";
}

// ─── Main Orchestrator Function ───────────────────────────────────────────────
/**
 * Process one user turn in the call.
 * @param {object} params
 * @param {string} params.transcript - What the user said
 * @param {string} params.currentState - Current agent state
 * @param {string} params.language - 'en' | 'hi'
 * @param {object} params.collectedAnswers - All answers gathered so far
 * @returns {Promise<object>} Agent response with next question + metadata
 */
export async function processAnswer({ transcript, currentState, language, collectedAnswers }) {
  if (currentState === AGENT_STATES.GREETING) {
    return {
      extractedValue: null,
      confidence: 1,
      fraudSignals: [],
      inconsistency: null,
      nextState: AGENT_STATES.IDENTITY_NAME,
      nextQuestion: getGreeting(language),
      probeRequired: false,
    };
  }

  // Deterministic closing — don't rely on LLM to figure out the final state
  if (currentState === AGENT_STATES.DOCUMENT_VERIFY) {
    const closingMsg = language === 'hi'
      ? 'बहुत बढ़िया! आपके दस्तावेज़ की जानकारी दर्ज कर ली गई है। आपका KYC साक्षात्कार अब पूरा हो गया है। हम आपके आवेदन की समीक्षा करेंगे और जल्द ही आपसे संपर्क करेंगे। धन्यवाद!'
      : "Perfect! We've noted your document details. Your KYC interview is now complete. We'll review your application and get back to you shortly. Thank you for your time!";
    return {
      extractedValue: transcript,
      confidence: 0.9,
      fraudSignals: [],
      inconsistency: null,
      nextState: AGENT_STATES.CALL_COMPLETE,
      nextQuestion: closingMsg,
      probeRequired: false,
    };
  }

  if (currentState === AGENT_STATES.CALL_COMPLETE) {
    return {
      extractedValue: null,
      confidence: 1,
      fraudSignals: [],
      inconsistency: null,
      nextState: AGENT_STATES.CALL_COMPLETE,
      nextQuestion: language === 'hi'
        ? 'धन्यवाद! आपका KYC इंटरव्यू पूरा हो गया है। हम आपके आवेदन की समीक्षा करेंगे और जल्द ही आपसे संपर्क करेंगे।'
        : 'Thank you! Your KYC interview is now complete. We will review your application and get back to you shortly. Goodbye!',
      probeRequired: false,
    };
  }

  const systemPrompt = buildSystemPrompt(language, currentState, collectedAnswers);

  const result = await chat({
    systemPrompt,
    userMessage: `User's answer: "${transcript}"`,
    json: true,
  });

  // Ensure nextState is valid
  if (!AGENT_STATES[result.nextState]) {
    result.nextState = STATE_FLOW[currentState];
  }

  return result;
}

export { STATE_FLOW, STATE_FIELD };
