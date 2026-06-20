import Session from '../models/Session.model.js';
import { transcribeAudio } from '../services/ai/stt.service.js';
import { runPlannerLoop, startPlannerSession } from '../orchestrator/PlannerLoop.js';

/**
 * socketHandler.js — Thin adapter between Socket.IO events and the PlannerAgent.
 *
 * All socket event names are UNCHANGED from before:
 *   call:join, call:audio, call:transcript, call:silence, call:agent-response,
 *   call:user-transcript, call:complete, call:error
 *
 * The frontend does NOT need any changes.
 *
 * What changed:
 *   Before: handleUserResponse() → callOrchestrator.processAnswer() (fixed state machine)
 *   After:  handleUserResponse() → PlannerLoop.runPlannerLoop() (goal-driven agent loop)
 */

export const registerSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // ─── call:join ────────────────────────────────────────────────────────────
    // Triggered when the frontend connects and is ready to start or resume the call
    socket.on('call:join', async ({ sessionId, language }) => {
      console.log(`📞 Client joined session: ${sessionId} (Lang: ${language})`);
      socket.join(sessionId);

      try {
        const session = await Session.findById(sessionId);
        if (!session) {
          socket.emit('call:error', { message: 'Session not found.' });
          return;
        }

        // ── RECONNECT: replay last agent message, no LLM call needed ─────────
        const existingAgentMsg = session.transcript?.findLast?.(t => t.role === 'agent');
        if (existingAgentMsg) {
          console.log(`↩ Reconnect — replaying last message for session ${sessionId}`);
          socket.emit('call:agent-response', {
            question:   existingAgentMsg.text,
            state:      session.agentState || 'AGENTIC',
            stateLabel: 'Reconnected',
          });
          return;
        }

        // ── FRESH SESSION: PlannerAgent generates greeting ────────────────────
        const result = await startPlannerSession({ sessionId, language, socket, io });
        socket.emit('call:agent-response', result);

      } catch (error) {
        console.error('[call:join] Error:', error);
        socket.emit('call:error', { message: 'Failed to start session.' });
      }
    });

    // ─── call:transcript ──────────────────────────────────────────────────────
    // Triggered when frontend sends a pre-transcribed text (e.g., from browser STT)
    socket.on('call:transcript', async ({ text, sessionId }) => {
      console.log(`🎙 Transcript received [${sessionId}]: "${text}"`);
      try {
        const result = await runPlannerLoop({ sessionId, transcript: text, socket, io });
        if (result) socket.emit('call:agent-response', result);
      } catch (error) {
        console.error('[call:transcript] Error:', error);
        socket.emit('call:error', { message: 'Failed to process your response. Please try again.' });
      }
    });

    // ─── call:audio ───────────────────────────────────────────────────────────
    // Triggered when frontend sends raw audio buffer for Whisper transcription
    socket.on('call:audio', async ({ audio, sessionId }) => {
      console.log(`🎙 Audio received [${sessionId}]: ${audio ? audio.length : 0} bytes`);
      try {
        const session = await Session.findById(sessionId);
        if (!session) {
          socket.emit('call:error', { message: 'Session not found.' });
          return;
        }

        // Step 1: Transcribe audio
        const text = await transcribeAudio(audio, session.language);
        console.log(`🗣 Whisper transcribed [${sessionId}]: "${text}"`);

        // Emit transcript immediately so frontend shows what was heard
        socket.emit('call:user-transcript', { text });

        // Step 2: Handle empty transcription (silence)
        if (!text || text.trim() === '') {
          const lastAgentMsg = session.transcript?.findLast?.(t => t.role === 'agent');
          if (!lastAgentMsg || session.status === 'completed') return;

          const prefix = session.language === 'hi'
            ? 'मुझे लगता है आपने कुछ नहीं कहा। '
            : "I didn't catch that. ";

          socket.emit('call:agent-response', {
            question:   prefix + lastAgentMsg.text,
            state:      'AGENTIC',
            stateLabel: 'Please repeat',
            isReprompt: true,
          });
          return;
        }

        // Step 3: Route to PlannerAgent
        const result = await runPlannerLoop({ sessionId, transcript: text, socket, io });
        if (result) socket.emit('call:agent-response', result);

      } catch (error) {
        console.error('[call:audio] Error:', error);
        socket.emit('call:error', { message: 'Failed to process your voice response. Please try again.' });
      }
    });

    // ─── call:silence ─────────────────────────────────────────────────────────
    // Triggered when frontend detects the user has been silent for the timeout
    socket.on('call:silence', async ({ sessionId }) => {
      console.log(`🔇 Silence detected for session: ${sessionId}`);
      try {
        const session = await Session.findById(sessionId);
        if (!session || session.status === 'completed') return;

        const lastAgentMsg = session.transcript?.findLast?.(t => t.role === 'agent');
        if (!lastAgentMsg) return;

        const prefix = session.language === 'hi'
          ? 'मुझे लगता है आपने कुछ नहीं कहा। '
          : "I didn't catch that. ";

        socket.emit('call:agent-response', {
          question:   prefix + lastAgentMsg.text,
          state:      'AGENTIC',
          stateLabel: 'Please repeat',
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
