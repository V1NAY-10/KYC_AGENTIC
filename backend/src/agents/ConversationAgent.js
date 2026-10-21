import { BaseAgent } from './base/BaseAgent.js';

// Scripted first-ask questions (also the fallback if the LLM is unavailable).
// Regulated KYC flows want consistent, reviewable wording — and scripting the
// first ask removes an LLM round-trip from most turns.
const FALLBACK_QUESTIONS = {
  en: {
    fullName:        'Could you please tell me your full name as it appears on your ID?',
    dateOfBirth:     'What is your date of birth? Please say it in day-month-year format.',
    currentAddress:  'What is your current residential address, including city and state?',
    govtId:          'Could you please share your PAN number or your 12-digit Aadhaar number? Either one is fine.',
    panNumber:       'Could you please share your PAN number?',
    aadhaarNumber:   'Could you please read out your 12-digit Aadhaar number, four digits at a time?',
    monthlyIncome:   'What is your approximate monthly take-home income?',
    employerName:    'Where do you currently work — what is your employer\'s name?',
    employmentYears: 'How long have you been working with your current employer?',
    existingEMI:     'Do you have any existing loan EMIs you are paying monthly? If yes, roughly how much?',
    loanAmount:      'How much loan amount are you looking for?',
    loanPurpose:     'What would you be using this loan for?',
    loanTenure:      'Over how many months would you like to repay the loan?',
  },
  hi: {
    fullName:        'क्या आप अपना पूरा नाम बता सकते हैं, जैसा आपके ID में है?',
    dateOfBirth:     'आपकी जन्म तिथि क्या है? कृपया दिन-महीना-वर्ष में बताएं।',
    currentAddress:  'आपका वर्तमान पता क्या है? शहर और राज्य भी बताएं।',
    govtId:          'कृपया अपना PAN नंबर या 12 अंकों का आधार नंबर बताएं। इनमें से कोई एक काफी है।',
    panNumber:       'क्या आप अपना PAN नंबर बता सकते हैं?',
    aadhaarNumber:   'कृपया अपना 12 अंकों का आधार नंबर चार-चार अंकों में बताएं।',
    monthlyIncome:   'आपकी लगभग मासिक आय कितनी है?',
    employerName:    'आप अभी कहाँ काम करते हैं?',
    employmentYears: 'आप अपने वर्तमान नियोक्ता के साथ कितने समय से काम कर रहे हैं?',
    existingEMI:     'क्या आप कोई मौजूदा लोन की EMI चुका रहे हैं? कितनी?',
    loanAmount:      'आप कितना लोन लेना चाहते हैं?',
    loanPurpose:     'यह लोन किस उद्देश्य के लिए है?',
    loanTenure:      'आप कितने महीनों में लोन चुकाना चाहते हैं?',
  },
};

// ID question tailored to the card uploaded before the call
const ID_QUESTION_FOR_UPLOAD = {
  en: {
    pan:     'Since you uploaded your PAN card, could you please read out your PAN number? An Aadhaar number works too.',
    aadhaar: 'Since you uploaded your Aadhaar card, could you please read out your 12-digit Aadhaar number, four digits at a time? A PAN number works too.',
  },
  hi: {
    pan:     'आपने PAN कार्ड अपलोड किया है, कृपया अपना PAN नंबर बताएं। चाहें तो आधार नंबर भी दे सकते हैं।',
    aadhaar: 'आपने आधार कार्ड अपलोड किया है, कृपया अपना 12 अंकों का आधार नंबर चार-चार अंकों में बताएं। चाहें तो PAN नंबर भी दे सकते हैं।',
  },
};

// Short acknowledgements so scripted questions don't sound like a form
const ACKS = {
  en: ['Thank you{name}. ', 'Got it{name}. ', 'Great, thanks. ', 'Perfect. ', 'Thanks for that. '],
  hi: ['धन्यवाद{name}। ', 'ठीक है{name}। ', 'बहुत अच्छा। ', 'समझ गई। ', 'शुक्रिया। '],
};

/**
 * ConversationAgent
 *
 * Single responsibility: Generate the next natural, conversational question
 * for a specific KYC field in the correct language.
 *
 * Does NOT:
 *   - Extract values (IdentityAgent's job)
 *   - Decide what state to go to (PlannerAgent's job)
 *   - Run fraud analysis (FraudAgent's job)
 *
 * First ask of a field → scripted question (instant, no LLM).
 * Re-ask (probeReason set) → LLM writes a helpful, specific clarification.
 *
 * Input:  targetField, collectedFields, language, recentTurns, [probeReason], [uploadedDocTypes]
 * Output: { question, strategy }
 */
export class ConversationAgent extends BaseAgent {
  constructor() {
    super('ConversationAgent');
  }

  async run({ targetField, collectedFields = {}, language = 'en', recentTurns = [], probeReason, uploadedDocTypes = [], sessionId }) {
    if (!probeReason) {
      return this._scripted(targetField, language, collectedFields, uploadedDocTypes);
    }

    const lang = language === 'hi' ? 'Hindi' : 'English';
    const meta = this.semanticMemory.getFieldMeta(targetField);

    // Build conversation context from recent turns
    const recentContext = recentTurns
      .slice(-4)
      .map(t => `${t.role === 'agent' ? 'Aria' : 'User'}: ${t.text}`)
      .join('\n');

    // Summarize what we know about the user (for personalization)
    const knownFacts = Object.entries(collectedFields)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${this.semanticMemory.getFieldMeta(k).label}: ${v}`)
      .slice(0, 4)
      .join(', ');

    // ID step: either document is acceptable — steer towards the card they uploaded
    let fieldGuidance = '';
    if (targetField === 'govtId') {
      const uploaded = uploadedDocTypes.includes('pan') ? 'PAN card'
                     : uploadedDocTypes.includes('aadhaar') ? 'Aadhaar card' : null;
      fieldGuidance = `\nFIELD GUIDANCE: The user may give EITHER their PAN number OR their 12-digit Aadhaar number — only one is required, make that clear.${uploaded ? ` They uploaded their ${uploaded}, so ask for that number first.` : ''} Aadhaar is easiest to hear when read four digits at a time.`;
    }

    const systemPrompt = `You are Aria, a warm, professional loan KYC assistant at an Indian bank.
Your ONLY job this turn: generate ONE conversational question to collect the field "${meta.label}" (key: ${targetField}).

LANGUAGE: ${lang} — ALL output MUST be in ${lang}.
WHAT WE KNOW ABOUT THIS USER: ${knownFacts || 'Nothing yet — this is the start of the interview.'}
RECENT CONVERSATION:
${recentContext || '(Beginning of conversation)'}
${fieldGuidance}${probeReason ? `\nWHY RE-ASKING: ${probeReason} — Re-ask naturally and helpfully, not robotically.` : ''}

RULES:
- ONE question only — natural, warm, and conversational
- Do NOT sound like a form or checklist
- Use the user's name if you know it (from WHAT WE KNOW section)
- For financial questions: be professional and non-judgmental
- Keep it under 2 sentences
- Do not repeat the exact same phrasing if this is a re-ask

Return ONLY valid JSON:
{
  "question": "your question in ${lang}",
  "strategy": "direct|probe|gentle_redirect"
}`;

    try {
      const result = await this.callLLM({
        systemPrompt,
        userMessage: `Generate question for: ${meta.label}`,
        json: true,
        lane: 'secondary', // keep the primary model's rate-limit budget for extraction
      });

      if (!result?.question) throw new Error('Empty question from LLM');

      this.log('info', 'Question generated', { sessionId, targetField, strategy: result.strategy });
      return result;
    } catch (err) {
      this.log('error', 'LLM failed, using hardcoded fallback', { sessionId, targetField, error: err.message });
      return this._fallback(targetField, language);
    }
  }

  _scripted(field, language, collectedFields, uploadedDocTypes) {
    const lang = language === 'hi' ? 'hi' : 'en';

    let question = FALLBACK_QUESTIONS[lang][field];
    if (field === 'govtId') {
      const doc = uploadedDocTypes.includes('pan') ? 'pan' : uploadedDocTypes.includes('aadhaar') ? 'aadhaar' : null;
      if (doc) question = ID_QUESTION_FOR_UPLOAD[lang][doc];
    }
    if (!question) return this._fallback(field, language);

    const collectedCount = Object.values(collectedFields).filter(v => v !== null && v !== undefined).length;
    if (collectedCount === 0) return { question, strategy: 'direct' };

    // Use the first name only right after we learn it, so it doesn't feel repetitive
    const firstName = collectedCount === 1 && collectedFields.fullName
      ? String(collectedFields.fullName).trim().split(/\s+/)[0]
      : null;
    const ack = ACKS[lang][collectedCount % ACKS[lang].length]
      .replace('{name}', firstName ? (lang === 'hi' ? ` ${firstName} जी` : `, ${firstName}`) : '');

    return { question: ack + question, strategy: 'direct' };
  }

  _fallback(field, language) {
    const lang   = language === 'hi' ? 'hi' : 'en';
    const bucket = FALLBACK_QUESTIONS[lang];
    return {
      question: bucket[field] || (lang === 'hi' ? 'कृपया विस्तार से बताएं।' : 'Could you please elaborate on that?'),
      strategy: 'direct',
    };
  }
}
