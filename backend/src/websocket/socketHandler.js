import { verifyToken } from '@clerk/backend';
import Session from '../models/Session.model.js';
import { transcribeAudio } from '../services/ai/stt.service.js';
import { runPlannerLoop, startPlannerSession } from '../orchestrator/PlannerLoop.js';
import { WorkingMemory } from '../memory/WorkingMemory.js';
import { SemanticMemory } from '../memory/SemanticMemory.js';
import { redactAadhaar } from '../utils/govtIdParser.js';

const workingMemory  = new WorkingMemory();
const semanticMemory = new SemanticMemory();

const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // matches io maxHttpBufferSize headroom — far beyond any spoken answer

/**
 * socketHandler.js — Thin adapter between Socket.IO events and the PlannerAgent.
 *
 * Events:
 *   in:  call:join, call:audio, call:transcript, call:silence
 *   out: call:agent-response, call:user-transcript, call:complete, call:error
 *
 * Security:
 *   - Every connection must present a Clerk session token (handshake auth.token)
 *   - A socket may only join a session owned by its Clerk user, and every later
 *     event is bound to that joined session (payload sessionId is not trusted)
 */

export const registerSocketHandlers = (io) => {
  // ─── Handshake auth ─────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
      socket.data.userId = payload.sub;
      next();
    } catch (err) {
      console.warn(`[socket] Auth failed: ${err.message}`);
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    const languageOf = (session) => (session?.language === 'hi' ? 'hi' : 'en');

    // Re-send the last question (reconnect / silence), with progress so a refreshed page can redraw it
    const replayPrompt = async (session, prefixed) => {
      const lastAgentMsg = session.transcript?.findLast?.(t => t.role === 'agent');
      if (!lastAgentMsg) return;
      const wm      = await workingMemory.get(String(session._id));
      const missing = wm?.missingFields
        ?? semanticMemory.computeMissingFields(Object.fromEntries(session.collectedAnswers || []));
      const total   = semanticMemory.getAllRequiredFieldKeys().length;
      const prefix = !prefixed ? ''
        : languageOf(session) === 'hi' ? 'मुझे लगता है आपने कुछ नहीं कहा। ' : "I didn't catch that. ";
      socket.emit('call:agent-response', {
        question:   prefix + lastAgentMsg.text,
        state:      session.agentState === 'GREETING' ? 'AGENTIC' : (session.agentState || 'AGENTIC'),
        stateLabel: prefixed ? 'Please repeat' : 'Reconnected',
        isReprompt: true,
        currentField: wm?.probeField && missing.includes(wm.probeField) ? wm.probeField : (missing[0] || null),
        progress:   { completed: total - missing.length, total, missing },
      });
    };

    const handleTurn = async (transcript) => {
      const sessionId = socket.data.sessionId;
      const result = await runPlannerLoop({ sessionId, transcript, socket, io });
      if (result) socket.emit('call:agent-response', result);
    };

    // Returns the session this socket joined, or null (and emits an error)
    const joinedSession = async (payloadSessionId) => {
      const sessionId = socket.data.sessionId;
      if (!sessionId || (payloadSessionId && String(payloadSessionId) !== sessionId)) {
        socket.emit('call:error', { message: 'Not joined to this session.' });
        return null;
      }
      const session = await Session.findById(sessionId);
      if (!session) socket.emit('call:error', { message: 'Session not found.' });
      return session;
    };

    // ─── call:join ────────────────────────────────────────────────────────────
    // Triggered when the frontend connects and is ready to start or resume the call
    socket.on('call:join', async ({ sessionId, language } = {}) => {
      console.log(`📞 Client joined session: ${sessionId} (Lang: ${language})`);

      try {
        const session = sessionId ? await Session.findById(sessionId) : null;
        if (!session) {
          socket.emit('call:error', { message: 'Session not found.' });
          return;
        }
        if (session.clerkId !== socket.data.userId) {
          socket.emit('call:error', { message: 'You do not have access to this session.' });
          return;
        }

        socket.data.sessionId = String(session._id);
        socket.join(socket.data.sessionId);

        // ── ALREADY FINISHED: send the user straight to review ───────────────
        if (session.status === 'completed') {
          socket.emit('call:complete', {
            sessionId:        socket.data.sessionId,
            extractedFields:  session.extractedAnswers || [],
            alreadyCompleted: true,
          });
          return;
        }

        // ── RECONNECT: replay last agent message, no LLM call needed ─────────
        if (session.transcript?.some(t => t.role === 'agent')) {
          console.log(`↩ Reconnect — replaying last message for session ${sessionId}`);
          await replayPrompt(session, false);
          return;
        }

        // ── FRESH SESSION: PlannerAgent generates greeting ────────────────────
        const result = await startPlannerSession({ sessionId: socket.data.sessionId, language, socket, io });
        if (result) {
          socket.emit('call:agent-response', result);
        } else {
          await replayPrompt(await Session.findById(sessionId), false);
        }

      } catch (error) {
        console.error('[call:join] Error:', error);
        socket.emit('call:error', { message: 'Failed to start session.' });
      }
    });

    // ─── call:transcript ──────────────────────────────────────────────────────
    // Triggered when frontend sends a pre-transcribed text (e.g., from browser STT)
    socket.on('call:transcript', async ({ text, sessionId } = {}) => {
      try {
        const session = await joinedSession(sessionId);
        if (!session) return;
        if (!text || !String(text).trim()) return await replayPrompt(session, true);
        console.log(`🎙 Transcript received [${socket.data.sessionId}]`);
        await handleTurn(String(text).slice(0, 2000));
      } catch (error) {
        console.error('[call:transcript] Error:', error);
        socket.emit('call:error', { message: 'Failed to process your response. Please try again.' });
      }
    });

    // ─── call:audio ───────────────────────────────────────────────────────────
    // Triggered when frontend sends raw audio buffer for Whisper transcription
    socket.on('call:audio', async ({ audio, mimeType, sessionId } = {}) => {
      console.log(`🎙 Audio received [${socket.data.sessionId}]: ${audio ? audio.length : 0} bytes`);
      try {
        const session = await joinedSession(sessionId);
        if (!session) return;
        if (session.status === 'completed') return;

        if (audio && audio.length > MAX_AUDIO_BYTES) {
          socket.emit('call:error', { message: 'That recording was too long. Please answer briefly.' });
          return;
        }

        // Step 1: Transcribe audio
        const text = await transcribeAudio(audio, session.language, mimeType);
        console.log(`🗣 Whisper transcribed [${socket.data.sessionId}]: "${redactAadhaar(text)}"`);

        // Emit transcript immediately so frontend shows what was heard
        socket.emit('call:user-transcript', { text });

        // Step 2: Handle empty transcription (silence)
        if (!text || text.trim() === '') return await replayPrompt(session, true);

        // Step 3: Route to PlannerAgent
        await handleTurn(text);

      } catch (error) {
        console.error('[call:audio] Error:', error);
        socket.emit('call:error', { message: 'Failed to process your voice response. Please try again.', retry: true });
      }
    });

    // ─── call:silence ─────────────────────────────────────────────────────────
    // Triggered when frontend detects the user has been silent for the timeout
    socket.on('call:silence', async ({ sessionId } = {}) => {
      try {
        const session = await joinedSession(sessionId);
        if (!session || session.status === 'completed') return;
        await replayPrompt(session, true);
      } catch (error) {
        console.error('[call:silence] Error:', error);
      }
    });

    // ─── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`🔌 Client disconnected: ${socket.id} (${reason})`);
    });
  });
};
