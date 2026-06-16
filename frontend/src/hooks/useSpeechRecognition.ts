'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseAudioRecorderOptions {
  stream: MediaStream | null;
  onAudioReady: (blob: Blob) => void;
}

/**
 * Minimal, reliable audio recorder hook.
 * Just starts/stops MediaRecorder on the existing mic stream.
 * No VAD, no AudioContext, no complexity.
 */
export const useSpeechRecognition = ({ stream, onAudioReady }: UseAudioRecorderOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onAudioReadyRef = useRef(onAudioReady);
  const streamRef = useRef<MediaStream | null>(null);

  // Keep refs in sync with latest props to avoid stale closures
  useEffect(() => { onAudioReadyRef.current = onAudioReady; }, [onAudioReady]);
  useEffect(() => { streamRef.current = stream; }, [stream]);

  const startListening = useCallback(() => {
    const currentStream = streamRef.current;
    if (!currentStream) {
      console.warn('[Recorder] No stream available yet.');
      return;
    }
    // Stop any existing recorder first
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
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

    console.log(`[Recorder] Starting with mimeType: "${mimeType}"`);

    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : {});
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
        console.log(`[Recorder] Chunk received: ${e.data.size} bytes`);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
      console.log(`[Recorder] Stopped. Total blob size: ${blob.size} bytes`);
      if (blob.size > 0) {
        onAudioReadyRef.current(blob);
      } else {
        console.warn('[Recorder] Empty blob — nothing was recorded.');
      }
    };

    recorder.onerror = (e) => {
      console.error('[Recorder] MediaRecorder error:', e);
      setIsListening(false);
    };

    recorder.start(250); // collect data every 250ms
    mediaRecorderRef.current = recorder;
    setIsListening(true);
    console.log('[Recorder] Recording started.');
  }, []);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      console.log('[Recorder] Stop requested.');
    }
    setIsListening(false);
  }, []);

  const resetTranscript = useCallback(() => setTranscript(''), []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  return { isListening, transcript, setTranscript, startListening, stopListening, resetTranscript };
};
