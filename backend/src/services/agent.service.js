import { groq, MODEL_NAME } from '../config/llm.js';

/**
 * State machine:
 * GREETING -> ASK_NAME -> ASK_DOB -> ASK_ADDRESS -> CONFIRMATION -> COMPLETED
 */

const getSystemPrompt = (state, language) => {
  const isHindi = language === 'hi';
  
  const baseInstructions = `You are a professional, polite, and efficient KYC verification officer for a loan application. 
You are conducting a live video call with the applicant.
Your responses must be very brief, natural, and conversational. Do not output markdown, bullet points, or emojis.
Speak exactly what you want the text-to-speech engine to say.`;

  const languageInstruction = isHindi 
    ? `You MUST reply in conversational Hindi (written in Devanagari script). Example: "नमस्ते, आपका नाम क्या है?"`
    : `You MUST reply in English.`;

  let stateInstructions = '';
  switch (state) {
    case 'GREETING':
      stateInstructions = `State: GREETING. Greet the user, state that this is a brief KYC verification call, and ask them for their full legal name.`;
      break;
    case 'ASK_NAME':
      stateInstructions = `State: ASK_NAME. Acknowledge their name, then ask them for their Date of Birth to verify their identity.`;
      break;
    case 'ASK_DOB':
      stateInstructions = `State: ASK_DOB. Acknowledge their Date of Birth, then ask them for their current residential address.`;
      break;
    case 'ASK_ADDRESS':
      stateInstructions = `State: ASK_ADDRESS. Thank them for the address, and ask them for their approximate annual income.`;
      break;
    case 'CONFIRMATION':
      stateInstructions = `State: CONFIRMATION. Thank them for their income details. Conclude the call by saying the verification process is complete and their application is being reviewed. Do not ask any more questions.`;
      break;
    case 'COMPLETED':
      stateInstructions = `State: COMPLETED. The call is already over. Just say goodbye politely.`;
      break;
    default:
      stateInstructions = `State: UNKNOWN. Ask how you can help them.`;
  }

  return `${baseInstructions}\n${languageInstruction}\n${stateInstructions}`;
};

export const getNextState = (currentState) => {
  const transitions = {
    'GREETING': 'ASK_NAME',
    'ASK_NAME': 'ASK_DOB',
    'ASK_DOB': 'ASK_ADDRESS',
    'ASK_ADDRESS': 'CONFIRMATION',
    'CONFIRMATION': 'COMPLETED',
    'COMPLETED': 'COMPLETED',
  };
  return transitions[currentState] || 'COMPLETED';
};

export const generateAgentResponse = async (currentState, language, userTranscript) => {
  try {
    const systemPrompt = getSystemPrompt(currentState, language);
    
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    if (userTranscript) {
      messages.push({ role: 'user', content: userTranscript });
    } else {
      messages.push({ role: 'user', content: 'Hello, begin the KYC process.' });
    }

    const res = await groq.chat.completions.create({
      model: MODEL_NAME,
      messages,
      temperature: 0.3,
      max_tokens: 150,
    });

    const reply = res.choices[0].message.content.trim();
    const nextState = getNextState(currentState);

    return {
      reply,
      nextState
    };
  } catch (error) {
    console.error('Error generating agent response via Groq:', error);
    // Fallback response
    return {
      reply: language === 'hi' 
        ? "क्षमा करें, मुझे कुछ तकनीकी समस्या आ रही है। क्या आप दोहरा सकते हैं?" 
        : "I'm sorry, I'm experiencing some technical difficulties. Could you repeat that?",
      nextState: currentState // stay in current state
    };
  }
};
