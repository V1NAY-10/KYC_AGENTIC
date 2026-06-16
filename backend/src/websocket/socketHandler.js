import Session from '../models/Session.model.js';
import { processAnswer, getGreeting, AGENT_STATES, STATE_FIELD } from '../services/ai/callOrchestrator.js';
import { extractKYCFromTranscript } from '../services/ai/extraction.service.js';
import { transcribeAudio } from '../services/ai/stt.service.js';

// Human-readable label for the current state shown to the frontend
const STATE_LABEL = {
  GREETING:               'Starting up',
  IDENTITY_NAME:          'Full Name',
  IDENTITY_DOB:           'Date of Birth',
  IDENTITY_ADDRESS:       'Current Address',
  IDENTITY_PAN:           'PAN Number',
  FINANCIAL_INCOME:       'Monthly Income',
  FINANCIAL_EMPLOYER:     'Employer Name',
  FINANCIAL_TENURE:       'Employment Duration',
  FINANCIAL_EXISTING_EMI: 'Existing EMI',
  LOAN_AMOUNT:            'Loan Amount',
  LOAN_PURPOSE:           'Loan Purpose',
  LOAN_TENURE:            'Loan Tenure',
  DOCUMENT_VERIFY:        'Document Verification',
  CALL_COMPLETE:          'Complete',
};

export const registerSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // ─── call:join ────────────────────────────────────────────────────────────
    // Triggered when the frontend connects and is ready to start/resume the call
    socket.on('call:join', async ({ sessionId, language }) => {
      console.log(`📞 Client joined session: ${sessionId} (Lang: ${language})`);
      socket.join(sessionId);

      try {
        const session = await Session.findById(sessionId);
        if (!session) {
          socket.emit('call:error', { message: 'Session not found.' });
          return;
        }

        // ── RECONNECT: replay last agent message from DB, no LLM call ───────
        const existingAgentMsg = session.transcript.findLast(t => t.role === 'agent');
        if (existingAgentMsg) {
          console.log(`↩ Reconnect — replaying last message for session ${sessionId}`);
          socket.emit('call:agent-response', {
            question:   existingAgentMsg.text,
            state:      session.agentState,
            stateLabel: STATE_LABEL[session.agentState] || session.agentState,
          });
          return;
        }

        // ── FRESH SESSION: emit greeting (no transcript needed) ───────────────
        const greeting = getGreeting(language);

        session.transcript.push({ role: 'agent', text: greeting, state: AGENT_STATES.GREETING });
        // Move immediately to IDENTITY_NAME so next voice input is processed correctly
        session.agentState = AGENT_STATES.IDENTITY_NAME;
        await session.save();

        socket.emit('call:agent-response', {
          question:   greeting,
          state:      AGENT_STATES.IDENTITY_NAME,
          stateLabel: STATE_LABEL.IDENTITY_NAME,
        });

      } catch (error) {
        console.error('[call:join] Error:', error);
        socket.emit('call:error', { message: 'Failed to start session.' });
      }
    });

    // ─── call:transcript ──────────────────────────────────────────────────────
    // Triggered when the user finishes speaking and frontend sends the transcript
    socket.on('call:transcript', async ({ text, sessionId }) => {
      console.log(`🎙 Transcript received [${sessionId}]: "${text}"`);
      try {
        await handleUserResponse({ text, sessionId, socket, io });
      } catch (error) {
        console.error('[call:transcript] Error:', error);
        socket.emit('call:error', { message: 'Failed to process your response. Please try again.' });
      }
    });

    // ─── call:audio ───────────────────────────────────────────────────────────
    // Triggered when the user finishes speaking and frontend sends the audio buffer
    socket.on('call:audio', async ({ audio, sessionId }) => {
      console.log(`🎙 Audio received [${sessionId}]: ${audio ? audio.length : 0} bytes`);
      try {
        const session = await Session.findById(sessionId);
        if (!session) {
          socket.emit('call:error', { message: 'Session not found.' });
          return;
        }

        const text = await transcribeAudio(audio, session.language);
        console.log(`🗣 Whisper transcribed [${sessionId}]: "${text}"`);

        // Emit transcribed text immediately so the frontend knows what was heard
        socket.emit('call:user-transcript', { text });

        if (!text || text.trim() === '') {
          // Trigger silence flow if nothing was transcribed
          console.log(`[call:audio] Empty transcription, triggering silence reprompt`);
          
          const lastAgentMsg = session.transcript.findLast(t => t.role === 'agent');
          if (!lastAgentMsg || session.agentState === AGENT_STATES.CALL_COMPLETE) return;

          const silencePrefix = session.language === 'hi'
            ? 'मुझे लगता है आपने कुछ नहीं कहा। '
            : "I didn't catch that. ";

          socket.emit('call:agent-response', {
            question:   silencePrefix + lastAgentMsg.text,
            state:      session.agentState,
            stateLabel: STATE_LABEL[session.agentState] || session.agentState,
            isReprompt: true,
          });
          return;
        }

        await handleUserResponse({ text, sessionId, socket, io });
      } catch (error) {
        console.error('[call:audio] Error:', error);
        socket.emit('call:error', { message: 'Failed to process your voice response. Please try again.' });
      }
    });

    // ─── call:silence ─────────────────────────────────────────────────────────
    // Triggered by frontend when user has been silent for the silence timeout
    socket.on('call:silence', async ({ sessionId }) => {
      console.log(`🔇 Silence detected for session: ${sessionId}`);
      try {
        const session = await Session.findById(sessionId);
        if (!session) return;

        // Find the last question the agent asked and repeat it
        const lastAgentMsg = session.transcript.findLast(t => t.role === 'agent');
        if (!lastAgentMsg || session.agentState === AGENT_STATES.CALL_COMPLETE) return;

        const silencePrefix = session.language === 'hi'
          ? 'मुझे लगता है आपने कुछ नहीं कहा। '
          : "I didn't catch that. ";

        socket.emit('call:agent-response', {
          question:   silencePrefix + lastAgentMsg.text,
          state:      session.agentState,
          stateLabel: STATE_LABEL[session.agentState] || session.agentState,
          isReprompt: true,
        });
      } catch (error) {
        console.error('[call:silence] Error:', error);
      }
    });

    // ─── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });
};

// ─── Core user answer processor ──────────────────────────────────────────────
async function handleUserResponse({ text, sessionId, socket, io }) {
  const session = await Session.findById(sessionId);
  if (!session) return;

  const currentState = session.agentState;

  // Ignore if call is already over
  if (currentState === AGENT_STATES.CALL_COMPLETE) return;

  // Save user turn
  session.transcript.push({ role: 'user', text, state: currentState });

  // Build collected answers map for context (guard against legacy sessions)
  const rawMap = session.collectedAnswers;
  const collectedAnswers = rawMap instanceof Map
    ? Object.fromEntries(rawMap)
    : (rawMap || {});

  // ── Call the orchestrator LLM ─────────────────────────────────────────
  const result = await processAnswer({
    transcript: text,
    currentState,
    language: session.language,
    collectedAnswers,
  });

  // Persist extracted field using the proper field name from STATE_FIELD map
  if (result.extractedValue !== null && result.extractedValue !== undefined) {
    const fieldKey = STATE_FIELD[currentState];
    if (fieldKey) {
      session.collectedAnswers.set(fieldKey, result.extractedValue);
    }
  }

  // Persist agent reply
  session.transcript.push({
    role: 'agent',
    text: result.nextQuestion || '',
    state: result.nextState,
  });
  session.agentState = result.nextState;
  await session.save();

  // ── Emit agent response to frontend ──────────────────────────────────
  socket.emit('call:agent-response', {
    question:      result.nextQuestion,
    state:         result.nextState,
    stateLabel:    STATE_LABEL[result.nextState] || result.nextState,
    extractedValue: result.extractedValue,
    confidence:    result.confidence,
    fraudSignals:  result.fraudSignals,
    probeRequired: result.probeRequired,
  });

  // ── Call complete: extract KYC + run loan engine ──────────────────────
  if (result.nextState === AGENT_STATES.CALL_COMPLETE) {
    await handleCallComplete(session, io, sessionId);
  }
}

// ─── Post-call processing ─────────────────────────────────────────────────────
async function handleCallComplete(session, io, sessionId) {
  try {
    console.log(`✅ Call complete for session ${sessionId}. Starting KYC extraction...`);

    // 1. Extract structured KYC fields from the full transcript
    const extracted = await extractKYCFromTranscript(session.transcript, session.language);
    session.extractedAnswers = extracted;
    
    // We do NOT run the loan engine here anymore.
    // The user will review the extracted data on the frontend and submit it via REST API.
    
    session.status = 'completed';
    session.endTime = new Date();
    await session.save();

    console.log(`📋 KYC extraction done and saved. Emitting to frontend for review.`);

    // 2. Emit results to the frontend
    io.to(sessionId).emit('call:complete', {
      sessionId,
      extractedFields: extracted,
    });

  } catch (err) {
    console.error('[handleCallComplete] Error:', err);
    io.to(sessionId).emit('call:error', { message: 'Error processing results. Please contact support.' });
  }
}
