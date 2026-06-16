'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import io, { Socket } from 'socket.io-client';
import { useAppStore } from '@/store/useAppStore';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { WebcamFeed } from '@/components/WebcamFeed';
import { WaveformVisualizer } from '@/components/WaveformVisualizer';

// How long (ms) to wait after agent finishes speaking before declaring silence
const SILENCE_TIMEOUT_MS = 7000;

// Progress steps in order for the UI stepper
const CALL_STEPS = [
  { key: 'IDENTITY_NAME',          label: 'Name' },
  { key: 'IDENTITY_DOB',           label: 'Date of Birth' },
  { key: 'IDENTITY_ADDRESS',       label: 'Address' },
  { key: 'IDENTITY_PAN',           label: 'PAN' },
  { key: 'FINANCIAL_INCOME',       label: 'Income' },
  { key: 'FINANCIAL_EMPLOYER',     label: 'Employer' },
  { key: 'FINANCIAL_TENURE',       label: 'Tenure' },
  { key: 'FINANCIAL_EXISTING_EMI', label: 'EMI' },
  { key: 'LOAN_AMOUNT',            label: 'Amount' },
  { key: 'LOAN_PURPOSE',           label: 'Purpose' },
  { key: 'LOAN_TENURE',            label: 'Duration' },
  { key: 'DOCUMENT_VERIFY',        label: 'Documents' },
];

export default function CallPage() {
  const router = useRouter();
  const { sessionId, language } = useAppStore();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [agentText, setAgentText] = useState<string>('Connecting...');
  const [currentState, setCurrentState] = useState<string>('GREETING');
  const [currentStateLabel, setCurrentStateLabel] = useState<string>('Starting up');
  const [callStatus, setCallStatus] = useState<'connecting' | 'active' | 'processing' | 'complete'>('connecting');
  const [isReprompt, setIsReprompt] = useState(false);
  const [fraudWarning, setFraudWarning] = useState<string | null>(null);

  // Speech hooks
  const { isListening, transcript, startListening, stopListening, resetTranscript, setTranscript } =
    useSpeechRecognition({
      stream,
      onAudioReady: (blob) => {
        const s = socketRef.current;
        if (s && sessionId) {
          console.log('📤 Sending audio blob over socket.io, size:', blob.size);
          setCallStatus('processing');
          setFraudWarning(null);
          s.emit('call:audio', { audio: blob, sessionId });
        }
      }
    });
  const { speak, stop: stopSpeaking, isSpeaking } = useSpeechSynthesis();

  // Silence detection refs
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    // Start listening immediately
    startListening();
    
    // Automatically stop and send whatever audio we captured after 7 seconds
    silenceTimerRef.current = setTimeout(() => {
      console.log('⏳ 7 seconds passed — auto-stopping recording to process');
      stopListening();
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, startListening, stopListening]);

  // ─── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) {
      router.push('/onboard/setup');
      return;
    }

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const SOCKET_URL = API_URL.replace(/\/api$/, '');
    const newSocket = io(SOCKET_URL, { withCredentials: true });
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      console.log('✅ Socket connected');
      setCallStatus('active');
      newSocket.emit('call:join', { sessionId, language });
    });

    newSocket.on('call:agent-response', (data: {
      question: string;
      state: string;
      stateLabel?: string;
      isReprompt?: boolean;
      fraudSignals?: any[];
    }) => {
      console.log('🤖 Agent Response:', data);
      clearSilenceTimer();
      setAgentText(data.question);
      setCurrentState(data.state);
      setCurrentStateLabel(data.stateLabel || data.state);
      setIsReprompt(data.isReprompt || false);
      setCallStatus('active');

      // Show fraud warning if detected
      if (data.fraudSignals && data.fraudSignals.length > 0) {
        const highSeverity = data.fraudSignals.find(s => s.severity === 'high');
        if (highSeverity) {
          setFraudWarning('Inconsistency detected — please answer clearly.');
        }
      }

      stopListening();
      resetTranscript();

      speak(data.question, language === 'hi' ? 'hi-IN' : 'en-US', () => {
        if (data.state !== 'CALL_COMPLETE') {
          // Agent finished speaking, start recording and 7s timer
          startSilenceTimer();
        }
      });
    });

    // Call complete — navigate to review with results
    newSocket.on('call:complete', (data: { sessionId: string; extractedFields: any[] }) => {
      console.log('🏁 Call complete, navigating to review');
      setCallStatus('complete');
      clearSilenceTimer();
      stopListening();
      // Store results in sessionStorage for the review page
      sessionStorage.setItem('kycReviewData', JSON.stringify(data));
      setTimeout(() => router.push('/onboard/review'), 1500);
    });

    newSocket.on('call:user-transcript', (data: { text: string }) => {
      console.log('🗣 User transcript from backend:', data.text);
      setTranscript(data.text);
    });

    newSocket.on('call:error', (data: { message: string }) => {
      console.error('❌ Call error:', data.message);
      setAgentText(`Error: ${data.message}`);
      setCallStatus('active');
    });

    setSocket(newSocket);

    return () => {
      clearSilenceTimer();
      newSocket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, language, router]);

  // Audio recording handles voice capture and transmission natively via VAD; 
  // no manual text debouncer needed here.

  // ─── Step progress calculation ─────────────────────────────────────────────
  const currentStepIndex = CALL_STEPS.findIndex(s => s.key === currentState);
  const progressPercent = currentStepIndex < 0
    ? 0
    : Math.round(((currentStepIndex + 1) / CALL_STEPS.length) * 100);

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] max-w-5xl mx-auto px-4 w-full animate-fade-in">
      <h2 className="text-2xl md:text-3xl font-bold text-gradient mb-2 text-center">
        KYC Video Call — Personal Loan
      </h2>

      {/* Progress bar */}
      <div className="w-full max-w-2xl mb-6">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-white/50 uppercase tracking-wider">Progress</span>
          <span className="text-xs font-semibold text-blue-400">{progressPercent}%</span>
        </div>
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-700"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Step chips */}
        <div className="flex gap-1.5 flex-wrap mt-2">
          {CALL_STEPS.map((step, idx) => {
            const done = currentStepIndex > idx;
            const active = currentStepIndex === idx;
            return (
              <span
                key={step.key}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all duration-300 ${
                  done
                    ? 'bg-green-500/30 text-green-300 border border-green-500/30'
                    : active
                    ? 'bg-blue-500/30 text-blue-200 border border-blue-400/60 scale-105'
                    : 'bg-white/5 text-white/30 border border-white/10'
                }`}
              >
                {step.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="w-full flex flex-col md:flex-row gap-6">
        {/* Left side: Video */}
        <div className="flex-1 flex flex-col gap-4">
          <WebcamFeed onStreamReady={setStream} isAgentSpeaking={isSpeaking} />
          <WaveformVisualizer stream={stream} isActive={!isSpeaking && isListening} />
        </div>

        {/* Right side: Agent panel */}
        <div className="w-full md:w-80 glass-card flex flex-col p-6 rounded-xl border border-white/10 shadow-xl bg-black/40">

          {/* Status header */}
          <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
            <h3 className="text-base font-semibold text-white/90">AI Agent — Aria</h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              callStatus === 'processing'
                ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                : callStatus === 'complete'
                ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
            }`}>
              {callStatus === 'processing' ? 'Thinking...' : callStatus === 'complete' ? 'Done' : isSpeaking ? 'Speaking' : 'Listening'}
            </span>
          </div>

          <div className="flex-1 flex flex-col justify-center gap-4">
            {/* Collecting field badge */}
            {currentState !== 'GREETING' && currentState !== 'CALL_COMPLETE' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40 uppercase tracking-wider">Collecting</span>
                <span className="px-2 py-0.5 bg-purple-500/20 border border-purple-500/30 rounded-full text-purple-300 text-xs font-semibold">
                  {currentStateLabel}
                </span>
                {isReprompt && (
                  <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/30 rounded-full text-amber-300 text-[10px] font-semibold">
                    Repeat
                  </span>
                )}
              </div>
            )}

            {/* Agent speech bubble */}
            <div className={`p-4 rounded-xl border transition-all duration-300 ${
              isSpeaking
                ? 'bg-blue-500/15 border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
                : 'bg-white/5 border-white/10'
            }`}>
              <p className={`text-xs uppercase tracking-wider mb-2 font-semibold ${isSpeaking ? 'text-blue-400' : 'text-white/40'}`}>
                {isSpeaking ? '🎙 Agent Speaking...' : '⏳ Waiting for you...'}
              </p>
              <p className="text-sm leading-relaxed text-white/90">{agentText}</p>
            </div>

            {/* Fraud warning */}
            {fraudWarning && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                ⚠️ {fraudWarning}
              </div>
            )}

            {/* User speech area */}
            <div className="mt-2">
              <p className="text-xs uppercase tracking-wider text-green-400 mb-1.5 font-semibold">
                {isListening ? '🎤 You (listening...)' : '🤫 You'}
              </p>
              <div className={`min-h-[3.5rem] p-3 rounded-lg border text-sm italic transition-all duration-300 ${
                isListening
                  ? 'bg-green-500/5 border-green-500/30 text-white/80'
                  : 'bg-white/5 border-white/10 text-white/40'
              }`}>
                {transcript || (isListening ? 'Speak now...' : callStatus === 'processing' ? 'Processing...' : 'Waiting for agent...')}
              </div>
              {isListening && (
                <button
                  onClick={() => {
                    console.log('🎤 Manual stop request from button');
                    clearSilenceTimer();
                    stopListening();
                  }}
                  className="mt-2 w-full py-2 px-3 rounded-lg bg-green-600/80 hover:bg-green-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-300 border border-green-500/30 hover:scale-[1.02] active:scale-95"
                >
                  <span>✋ Done Speaking</span>
                </button>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="mt-6 flex gap-3">
            <button
              className="btn-primary flex-1 bg-red-500/80 hover:bg-red-500 text-white text-sm"
              onClick={() => {
                clearSilenceTimer();
                stopSpeaking();
                stopListening();
                if (socket) socket.disconnect();
                router.push('/onboard/setup');
              }}
            >
              End Call
            </button>
          </div>
        </div>
      </div>

      {/* Complete overlay */}
      {callStatus === 'complete' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card p-8 rounded-2xl border border-green-500/30 text-center max-w-sm mx-4">
            <div className="text-5xl mb-4">✅</div>
            <h3 className="text-xl font-bold text-white mb-2">Interview Complete!</h3>
            <p className="text-white/60 text-sm">Processing your application...</p>
            <div className="mt-4 h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-blue-500 rounded-full animate-pulse w-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
