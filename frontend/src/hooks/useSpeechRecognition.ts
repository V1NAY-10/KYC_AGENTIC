'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseAudioRecorderOptions {
  stream: MediaStream | null;
  onAudioReady: (blob: Blob, mimeType: string) => void;
  /** Called when the turn ended without any speech — nothing is uploaded. */
  onNoSpeech?: () => void;
}

// ── Voice activity detection tuning ─────────────────────────────────────────
const TICK_MS            = 100;
const CALIBRATE_MS       = 400;    // measure room noise before deciding what "speech" is
const MIN_SPEECH_MS      = 250;    // this much voiced audio counts as "the user started talking"
const END_SILENCE_MS     = 1800;   // pause after speech that ends the answer (digit-by-digit IDs have pauses)
const NO_SPEECH_MS       = 9000;   // nobody spoke at all
const MAX_RECORDING_MS   = 30000;  // hard cap per answer
const FALLBACK_RECORD_MS = 12000;  // fixed window if the AudioContext can't run (autoplay policy)
const MIN_RMS_THRESHOLD  = 0.012;

/**
 * Audio recorder with voice activity detection.
 * Records on the existing mic stream and ends the turn automatically when the
 * applicant stops talking — no fixed window that cuts long answers short.
 */
export const useSpeechRecognition = ({ stream, onAudioReady, onNoSpeech }: UseAudioRecorderOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onAudioReadyRef = useRef(onAudioReady);
  const onNoSpeechRef = useRef(onNoSpeech);
  const streamRef = useRef<MediaStream | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Per-recording flag: an old recorder's async onstop must not read the next one's state
  const recordingRef = useRef<{ discard: boolean }>({ discard: false });

  // Keep refs in sync with latest props to avoid stale closures
  useEffect(() => { onAudioReadyRef.current = onAudioReady; }, [onAudioReady]);
  useEffect(() => { onNoSpeechRef.current = onNoSpeech; }, [onNoSpeech]);
  useEffect(() => { streamRef.current = stream; }, [stream]);

  const clearVad = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    vadSourceRef.current?.disconnect();
    vadSourceRef.current = null;
  }, []);

  const finishRecording = useCallback((discard: boolean) => {
    clearVad();
    recordingRef.current.discard = discard;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  }, [clearVad]);

  const startVad = useCallback((audioStream: MediaStream) => {
    clearVad();

    let ctx = audioCtxRef.current;
    try {
      if (!ctx) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctx();
        audioCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {
      ctx = null;
    }

    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    if (ctx) {
      source = ctx.createMediaStreamSource(audioStream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      vadSourceRef.current = source;
    }
    const samples = new Float32Array(analyser?.fftSize ?? 1024);

    const startedAt = Date.now();
    let noiseFloor = 0;
    let calibrationTicks = 0;
    let voicedMs = 0;
    let speechStarted = false;
    let lastVoiceAt = 0;

    vadTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const vadUsable = Boolean(analyser && ctx && ctx.state === 'running');

      if (!vadUsable) {
        // Can't measure audio — behave like a fixed recording window and always upload
        if (elapsed >= FALLBACK_RECORD_MS) finishRecording(false);
        return;
      }

      analyser!.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);

      if (elapsed < CALIBRATE_MS) {
        noiseFloor = (noiseFloor * calibrationTicks + rms) / (calibrationTicks + 1);
        calibrationTicks++;
        return;
      }

      const threshold = Math.max(MIN_RMS_THRESHOLD, noiseFloor * 2.5);
      if (rms > threshold) {
        voicedMs += TICK_MS;
        lastVoiceAt = Date.now();
        if (voicedMs >= MIN_SPEECH_MS) speechStarted = true;
      }

      const done =
        (speechStarted && Date.now() - lastVoiceAt >= END_SILENCE_MS) ||
        elapsed >= MAX_RECORDING_MS;
      const nobodySpoke = !speechStarted && elapsed >= NO_SPEECH_MS;

      if (done || nobodySpoke) {
        finishRecording(nobodySpoke);
        if (nobodySpoke) onNoSpeechRef.current?.();
      }
    }, TICK_MS);
  }, [clearVad, finishRecording]);

  const startListening = useCallback(() => {
    const currentStream = streamRef.current;
    if (!currentStream) {
      console.warn('[Recorder] No stream available yet.');
      return;
    }
    // Stop any existing recorder first (without uploading it)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      recordingRef.current.discard = true;
      mediaRecorderRef.current.stop();
    }

    // Only record the audio track
    const audioTracks = currentStream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.warn('[Recorder] No audio tracks found in stream.');
      return;
    }
    const audioStream = new MediaStream(audioTracks);

    // Pick the best supported mime type
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';

    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    chunksRef.current = chunks;
    const recording = { discard: false };
    recordingRef.current = recording;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      if (recording.discard) return;
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type });
      if (blob.size > 0) {
        onAudioReadyRef.current(blob, type);
      } else {
        console.warn('[Recorder] Empty blob — nothing was recorded.');
        onNoSpeechRef.current?.();
      }
    };

    recorder.onerror = (e) => {
      console.error('[Recorder] MediaRecorder error:', e);
      clearVad();
      setIsListening(false);
    };

    recorder.start(250); // collect data every 250ms
    mediaRecorderRef.current = recorder;
    setIsListening(true);
    startVad(audioStream);
  }, [clearVad, startVad]);

  /** User pressed "Done speaking" — end the turn and upload what was said. */
  const stopListening = useCallback(() => finishRecording(false), [finishRecording]);

  /** End the turn without uploading (e.g. Aria started speaking again). */
  const cancelListening = useCallback(() => finishRecording(true), [finishRecording]);

  const resetTranscript = useCallback(() => setTranscript(''), []);

  // Clean up on unmount — never upload from a dying page
  useEffect(() => {
    return () => {
      clearVad();
      recordingRef.current.discard = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [clearVad]);

  return { isListening, transcript, setTranscript, startListening, stopListening, cancelListening, resetTranscript };
};
