import { BaseAgent } from './base/BaseAgent.js';

// Hardcoded fallback questions so the agent never goes silent
const FALLBACK_QUESTIONS = {
  en: {
    fullName:        'Could you please tell me your full name as it appears on your ID?',
    dateOfBirth:     'What is your date of birth? Please say it in day-month-year format.',
    currentAddress:  'What is your current residential address, including city and state?',
    panNumber:       'Could you please share your PAN number?',
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
    panNumber:       'क्या आप अपना PAN नंबर बता सकते हैं?',
    monthlyIncome:   'आपकी लगभग मासिक आय कितनी है?',
    employerName:    'आप अभी कहाँ काम करते हैं?',
    employmentYears: 'आप अपने वर्तमान नियोक्ता के साथ कितने समय से काम कर रहे हैं?',
    existingEMI:     'क्या आप कोई मौजूदा लोन की EMI चुका रहे हैं? कितनी?',
    loanAmount:      'आप कितना लोन लेना चाहते हैं?',
    loanPurpose:     'यह लोन किस उद्देश्य के लिए है?',
    loanTenure:      'आप कितने महीनों में लोन चुकाना चाहते हैं?',
  },
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
 * Input:  targetField, collectedFields, language, recentTurns, [probeReason]
 * Output: { question, strategy }
 */
export class ConversationAgent extends BaseAgent {
  constructor() {
    super('ConversationAgent');
  }

  async run({ targetField, collectedFields = {}, language = 'en', recentTurns = [], probeReason, sessionId }) {
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

    const systemPrompt = `You are Aria, a warm, professional loan KYC assistant at an Indian bank.
Your ONLY job this turn: generate ONE conversational question to collect the field "${meta.label}" (key: ${targetField}).

LANGUAGE: ${lang} — ALL output MUST be in ${lang}.
WHAT WE KNOW ABOUT THIS USER: ${knownFacts || 'Nothing yet — this is the start of the interview.'}
RECENT CONVERSATION:
${recentContext || '(Beginning of conversation)'}
${probeReason ? `\nWHY RE-ASKING: ${probeReason} — Re-ask naturally and helpfully, not robotically.` : ''}

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
      });

      if (!result?.question) throw new Error('Empty question from LLM');

      this.log('info', 'Question generated', { sessionId, targetField, strategy: result.strategy });
      return result;
    } catch (err) {
      this.log('error', 'LLM failed, using hardcoded fallback', { sessionId, targetField, error: err.message });
      return this._fallback(targetField, language);
    }
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
