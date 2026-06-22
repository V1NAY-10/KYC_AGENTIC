'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import io, { Socket } from 'socket.io-client';
import { useAppStore } from '@/store/useAppStore';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { WebcamFeed } from '@/components/WebcamFeed';
import { WaveformVisualizer } from '@/components/WaveformVisualizer';

const SILENCE_TIMEOUT_MS = 7000;

const CALL_STEPS = [
  { key: 'IDENTITY_NAME',          label: 'Full Name',       icon: '👤' },
  { key: 'IDENTITY_DOB',           label: 'Date of Birth',   icon: '📅' },
  { key: 'IDENTITY_ADDRESS',       label: 'Address',         icon: '📍' },
  { key: 'IDENTITY_PAN',           label: 'PAN Number',      icon: '🪪' },
  { key: 'FINANCIAL_INCOME',       label: 'Monthly Income',  icon: '💰' },
  { key: 'FINANCIAL_EMPLOYER',     label: 'Employer',        icon: '🏢' },
  { key: 'FINANCIAL_TENURE',       label: 'Employment Years',icon: '📆' },
  { key: 'FINANCIAL_EXISTING_EMI', label: 'Existing EMI',    icon: '📊' },
  { key: 'LOAN_AMOUNT',            label: 'Loan Amount',     icon: '🏦' },
  { key: 'LOAN_PURPOSE',           label: 'Loan Purpose',    icon: '🎯' },
  { key: 'LOAN_TENURE',            label: 'Loan Duration',   icon: '⏱' },
];

interface AgentResponseData {
  question: string;
  state: string;
  stateLabel?: string;
  isReprompt?: boolean;
  fraudSignals?: { severity: string }[];
}

interface CallCompleteData {
  sessionId: string;
  extractedFields: unknown[];
}

export default function CallPage() {
  const router = useRouter();
  const { sessionId, language } = useAppStore();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [agentText, setAgentText] = useState<string>('Connecting to Aria...');
  const [currentState, setCurrentState] = useState<string>('GREETING');
  const [currentStateLabel, setCurrentStateLabel] = useState<string>('Starting up');
  const [callStatus, setCallStatus] = useState<'connecting' | 'active' | 'processing' | 'complete'>('connecting');
  const [isReprompt, setIsReprompt] = useState(false);
  const [fraudWarning, setFraudWarning] = useState<string | null>(null);

  const { isListening, transcript, startListening, stopListening, resetTranscript, setTranscript } =
    useSpeechRecognition({
      stream,
      onAudioReady: (blob) => {
        const s = socketRef.current;
        if (s && sessionId) {
          setCallStatus('processing');
          setFraudWarning(null);
          s.emit('call:audio', { audio: blob, sessionId });
        }
      }
    });
  const { speak, stop: stopSpeaking, isSpeaking } = useSpeechSynthesis();

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
    startListening();
    silenceTimerRef.current = setTimeout(() => {
      stopListening();
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, startListening, stopListening]);

  useEffect(() => {
    if (!sessionId) { router.push('/onboard/setup'); return; }

    // NEXT_PUBLIC_SOCKET_URL → e.g. https://kyc-backend.onrender.com  (production)
    //                          or   http://localhost:8000              (dev)
    const SOCKET_URL =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/api$/, '');

    const newSocket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],   // polling fallback for Render proxy
      reconnectionAttempts: 5,
      reconnectionDelay: 1500,
    });
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      setCallStatus('active');
      newSocket.emit('call:join', { sessionId, language });
    });

    newSocket.on('call:agent-response', (data: AgentResponseData) => {
      clearSilenceTimer();
      setAgentText(data.question);
      setCurrentState(data.state);
      setCurrentStateLabel(data.stateLabel || data.state);
      setIsReprompt(data.isReprompt || false);
      setCallStatus('active');
      if (data.fraudSignals && data.fraudSignals.length > 0) {
        const highSeverity = data.fraudSignals.find(s => s.severity === 'high');
        if (highSeverity) setFraudWarning('Inconsistency detected — please answer clearly.');
      }
      stopListening();
      resetTranscript();
      speak(data.question, language === 'hi' ? 'hi-IN' : 'en-US', () => {
        if (data.state !== 'CALL_COMPLETE') startSilenceTimer();
      });
    });

    newSocket.on('call:complete', (data: CallCompleteData) => {
      setCallStatus('complete');
      clearSilenceTimer();
      stopListening();
      sessionStorage.setItem('kycReviewData', JSON.stringify(data));
      setTimeout(() => router.push('/onboard/review'), 1500);
    });

    newSocket.on('call:user-transcript', (data: { text: string }) => {
      setTranscript(data.text);
    });

    newSocket.on('call:error', (data: { message: string }) => {
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

  const currentStepIndex = CALL_STEPS.findIndex(s => s.key === currentState);
  const progressPercent = currentStepIndex < 0
    ? 0
    : Math.round(((currentStepIndex + 1) / CALL_STEPS.length) * 100);

  /* ── Status helpers ── */
  const statusLabel =
    callStatus === 'processing' ? 'Thinking…'  :
    callStatus === 'complete'   ? 'Done'        :
    isSpeaking                  ? 'Speaking'    :
    isListening                 ? 'Listening'   : 'Connecting…';

  const statusColor =
    callStatus === 'processing' ? { bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.4)',  text: '#F59E0B' } :
    callStatus === 'complete'   ? { bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.4)',  text: '#10B981' } :
    isSpeaking                  ? { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.4)',  text: '#60A5FA' } :
    isListening                 ? { bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.35)', text: '#34D399' } :
                                  { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.2)', text: '#94A3B8' };

  /* ── Video ring class ── */
  const videoRingClass = isSpeaking ? 'speaking-ring' : isListening ? 'listening-ring' : '';

  return (
    <div style={{
      height: 'calc(100vh - 60px)',
      display: 'flex',
      flexDirection: 'column',
      background: '#080B14',
      fontFamily: 'var(--font-family)',
      overflow: 'hidden',
    }}>

      {/* ── Top progress bar ── */}
      <div style={{
        padding: '10px 1.5rem 0',
        flexShrink: 0,
        background: 'rgba(8,11,20,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Aria logo micro */}
            <div style={{
              width: '20px', height: '20px', borderRadius: '5px',
              background: 'linear-gradient(135deg, #2563EB, #8B5CF6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <span style={{ color: 'white', fontSize: '0.625rem', fontWeight: '800' }}>A</span>
            </div>
            <span style={{ fontSize: '0.8125rem', fontWeight: '700', color: 'var(--color-text-primary)', letterSpacing: '-0.2px' }}>
              KYC Interview
            </span>
            <span style={{
              fontSize: '0.6rem', fontWeight: '700', padding: '1px 6px', borderRadius: '20px',
              background: statusColor.bg, color: statusColor.text,
              border: `1px solid ${statusColor.border}`, letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>{statusLabel}</span>
          </div>
          <span style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--color-accent-blue)' }}>
            {progressPercent}%
          </span>
        </div>
        {/* Progress track */}
        <div style={{ height: '3px', background: 'rgba(255,255,255,0.07)', borderRadius: '2px', overflow: 'hidden', marginBottom: '8px' }}>
          <div style={{
            height: '100%', borderRadius: '2px',
            background: 'linear-gradient(90deg, #2563EB, #8B5CF6)',
            width: `${progressPercent}%`,
            transition: 'width 0.7s ease',
            boxShadow: '0 0 8px rgba(59,130,246,0.5)',
          }} />
        </div>
      </div>

      {/* ── Main split layout ── */}
      <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden', minHeight: 0 }}>

        {/* ── LEFT: Webcam ── */}
        <div style={{
          flex: '0 0 60%',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.25rem 0.75rem 1.25rem 1.25rem',
          gap: '0.75rem',
          background: '#080B14',
          minWidth: 0,
        }}>
          {/* Video container with animated ring */}
          <div style={{
            flex: 1,
            borderRadius: '16px',
            overflow: 'hidden',
            position: 'relative',
            minHeight: 0,
          }} className={videoRingClass}>
            <WebcamFeed onStreamReady={setStream} isAgentSpeaking={isSpeaking} />

            {/* Overlay: current field being collected */}
            {currentState !== 'GREETING' && currentState !== 'CALL_COMPLETE' && (
              <div style={{
                position: 'absolute', top: '12px', right: '12px',
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'rgba(8,11,20,0.80)', backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.10)', borderRadius: '20px',
                padding: '5px 12px',
              }}>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', fontWeight: '500' }}>Collecting</span>
                <span style={{
                  fontSize: '0.75rem', fontWeight: '700', color: '#A78BFA',
                  background: 'rgba(139,92,246,0.15)', padding: '1px 8px', borderRadius: '12px',
                  border: '1px solid rgba(139,92,246,0.3)'
                }}>{currentStateLabel}</span>
                {isReprompt && (
                  <span style={{
                    fontSize: '0.625rem', fontWeight: '800', color: '#FCD34D',
                    background: 'rgba(245,158,11,0.15)', padding: '1px 6px', borderRadius: '10px',
                    border: '1px solid rgba(245,158,11,0.3)', textTransform: 'uppercase', letterSpacing: '0.04em'
                  }}>Retry</span>
                )}
              </div>
            )}

            {/* Fraud warning overlay */}
            {fraudWarning && (
              <div style={{
                position: 'absolute', bottom: '12px', left: '12px', right: '12px',
                background: 'rgba(245,158,11,0.15)', backdropFilter: 'blur(12px)',
                border: '1px solid rgba(245,158,11,0.4)', borderRadius: '10px',
                padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ fontSize: '1rem' }}>⚠️</span>
                <span style={{ fontSize: '0.8rem', color: '#FCD34D', fontWeight: '500' }}>{fraudWarning}</span>
              </div>
            )}
          </div>

          {/* Waveform */}
          <div style={{
            flexShrink: 0, height: '48px',
            borderRadius: '10px', overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.02)',
          }}>
            <WaveformVisualizer stream={stream} isActive={!isSpeaking && isListening} />
          </div>
        </div>

        {/* ── RIGHT: Agent Panel ── */}
        <div style={{
          flex: '0 0 40%',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.25rem',
          gap: '1rem',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.01)',
          minWidth: 0,
          overflowY: 'auto',
        }}>

          {/* Agent identity header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            paddingBottom: '0.875rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}>
            {/* Avatar */}
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: isSpeaking ? '0 0 16px rgba(59,130,246,0.5)' : 'none',
              transition: 'box-shadow 0.3s ease',
            }}>
              <span style={{ color: 'white', fontWeight: '800', fontSize: '1rem' }}>A</span>
            </div>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: '700', color: 'var(--color-text-primary)', lineHeight: 1 }}>
                Aria
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.45)', marginTop: '3px' }}>
                AI Loan Interview Agent
              </div>
            </div>
            {/* Live status badge */}
            <div style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px',
              padding: '4px 10px', borderRadius: '20px',
              background: statusColor.bg, border: `1px solid ${statusColor.border}`,
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor.text, flexShrink: 0 }} className={isSpeaking || isListening ? 'animate-pulse' : ''} />
              <span style={{ fontSize: '0.6875rem', fontWeight: '700', color: statusColor.text, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {statusLabel}
              </span>
            </div>
          </div>

          {/* Agent speech bubble */}
          <div style={{
            flex: '0 0 auto',
            padding: '1rem 1.25rem',
            borderRadius: '14px',
            background: isSpeaking
              ? 'linear-gradient(135deg, rgba(29,78,216,0.12), rgba(124,58,237,0.08))'
              : 'rgba(255,255,255,0.03)',
            border: isSpeaking
              ? '1px solid rgba(59,130,246,0.35)'
              : '1px solid rgba(255,255,255,0.07)',
            boxShadow: isSpeaking ? '0 0 20px rgba(59,130,246,0.08)' : 'none',
            transition: 'all 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.625rem' }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: '700', color: isSpeaking ? '#60A5FA' : 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {isSpeaking ? 'Aria is speaking' : callStatus === 'processing' ? 'Processing…' : 'Waiting for you'}
              </span>
              {/* Typing dots when processing */}
              {callStatus === 'processing' && (
                <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                  <span className="typing-dot-1" style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#60A5FA', display: 'inline-block' }} />
                  <span className="typing-dot-2" style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#60A5FA', display: 'inline-block' }} />
                  <span className="typing-dot-3" style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#60A5FA', display: 'inline-block' }} />
                </div>
              )}
            </div>
            <p style={{ fontSize: '0.9375rem', lineHeight: 1.65, color: 'var(--color-text-primary)', fontWeight: '400' }}>
              {agentText}
            </p>
          </div>

          {/* User transcript area */}
          <div style={{
            flex: '0 0 auto',
            padding: '0.875rem 1.25rem',
            borderRadius: '14px',
            background: isListening ? 'rgba(16,185,129,0.05)' : 'rgba(255,255,255,0.02)',
            border: isListening ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.06)',
            transition: 'all 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50', flexShrink: 0,
                background: isListening ? '#10B981' : 'rgba(255,255,255,0.2)',
              }} className={isListening ? 'animate-pulse' : ''} />
              <span style={{ fontSize: '0.6875rem', fontWeight: '700', color: isListening ? '#34D399' : 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {isListening ? 'You (speaking)' : 'You'}
              </span>
            </div>
            <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: transcript ? 'var(--color-text-primary)' : 'rgba(255,255,255,0.25)', fontStyle: transcript ? 'normal' : 'italic', minHeight: '2.5rem' }}>
              {transcript || (isListening ? 'Speak now…' : callStatus === 'processing' ? 'Processing your response…' : 'Waiting for Aria…')}
            </p>
            {/* Done speaking button */}
            {isListening && (
              <button
                onClick={() => { clearSilenceTimer(); stopListening(); }}
                style={{
                  marginTop: '0.625rem',
                  width: '100%', padding: '8px',
                  borderRadius: '8px',
                  background: 'rgba(16,185,129,0.15)',
                  border: '1px solid rgba(16,185,129,0.3)',
                  color: '#34D399', fontSize: '0.8125rem', fontWeight: '700',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.25)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.15)')}
              >
                ✋ Done Speaking
              </button>
            )}
          </div>

          {/* Progress steps */}
          <div style={{
            flex: 1,
            borderRadius: '14px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            padding: '0.875rem 1rem',
            overflowY: 'auto',
            minHeight: 0,
          }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: '700', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
              Interview Progress
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {CALL_STEPS.map((step, idx) => {
                const done   = currentStepIndex > idx;
                const active = currentStepIndex === idx;
                const future = currentStepIndex < idx;
                return (
                  <div key={step.key} style={{
                    display: 'flex', alignItems: 'center', gap: '0.625rem',
                    padding: '5px 8px', borderRadius: '8px',
                    background: active ? 'rgba(59,130,246,0.10)' : done ? 'rgba(16,185,129,0.06)' : 'transparent',
                    border: active ? '1px solid rgba(59,130,246,0.25)' : '1px solid transparent',
                    transition: 'all 0.3s ease',
                  }}>
                    {/* Step indicator */}
                    <div style={{
                      width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: done   ? 'rgba(16,185,129,0.20)'  :
                                  active ? 'rgba(59,130,246,0.20)'  : 'rgba(255,255,255,0.05)',
                      border: done   ? '1px solid rgba(16,185,129,0.40)'  :
                              active ? '1px solid rgba(59,130,246,0.50)'  : '1px solid rgba(255,255,255,0.08)',
                      fontSize: '0.6rem',
                    }}>
                      {done ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      ) : (
                        <span style={{ color: active ? '#60A5FA' : 'rgba(255,255,255,0.2)', fontWeight: '700', fontSize: '0.5rem' }}>
                          {idx + 1}
                        </span>
                      )}
                    </div>
                    <span style={{
                      fontSize: '0.75rem', fontWeight: active ? '600' : '400',
                      color: done   ? '#34D399'              :
                             active ? 'var(--color-text-primary)' : 'rgba(255,255,255,0.3)',
                      transition: 'color 0.3s',
                    }}>
                      {step.label}
                    </span>
                    {active && (
                      <span style={{
                        marginLeft: 'auto', width: '6px', height: '6px', borderRadius: '50%',
                        background: '#3B82F6', flexShrink: 0,
                      }} className="animate-pulse" />
                    )}
                    {future && (
                      <span style={{ marginLeft: 'auto', fontSize: '0.55rem', color: 'rgba(255,255,255,0.2)', fontWeight: '500' }}>
                        upcoming
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* End call button */}
          <button
            style={{
              flexShrink: 0,
              width: '100%', padding: '12px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(220,38,38,0.20), rgba(239,68,68,0.12))',
              border: '1px solid rgba(239,68,68,0.35)',
              color: '#FCA5A5', fontSize: '0.875rem', fontWeight: '700',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.625rem',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.25)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.55)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(220,38,38,0.20), rgba(239,68,68,0.12))';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.35)';
            }}
            onClick={() => {
              clearSilenceTimer();
              stopSpeaking();
              stopListening();
              if (socket) socket.disconnect();
              router.push('/onboard/setup');
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
            End Interview
          </button>
        </div>
      </div>

      {/* ── Completion overlay ── */}
      {callStatus === 'complete' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(8,11,20,0.85)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(16,185,129,0.35)',
            borderRadius: '20px', padding: '3rem 2.5rem',
            textAlign: 'center', maxWidth: '360px', width: '90%',
            boxShadow: '0 0 60px rgba(16,185,129,0.12)',
          }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '1rem', lineHeight: 1 }}>✅</div>
            <h3 style={{ fontSize: '1.375rem', fontWeight: '800', color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>
              Interview Complete!
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              Aria has finished collecting your information. Preparing your application for review…
            </p>
            <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '2px',
                background: 'linear-gradient(90deg, #10B981, #3B82F6)',
                width: '100%',
              }} className="animate-pulse" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
