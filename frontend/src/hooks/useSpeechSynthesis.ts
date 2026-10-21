import { useState, useCallback, useEffect, useRef } from 'react';

// Chrome sometimes never fires onend (long utterances, tab switches). If that
// happens the mic would never re-open, so a watchdog finishes the utterance.
const WATCHDOG_BASE_MS = 4000;
const WATCHDOG_MS_PER_CHAR = 90;

export const useSpeechSynthesis = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceIdRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const loadVoices = () => {
        setVoices(window.speechSynthesis.getVoices());
      };

      // Load initially
      loadVoices();

      // Chrome needs this event to load voices
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
  }, []);

  const speak = useCallback((text: string, language: string = 'en-US', onEnd?: () => void) => {
    if (!window.speechSynthesis) {
      console.warn('Speech synthesis not supported');
      if (onEnd) onEnd();
      return;
    }

    // Cancel any ongoing speech — its callbacks are ignored via the id check below
    window.speechSynthesis.cancel();
    if (watchdogRef.current) clearTimeout(watchdogRef.current);

    const id = ++utteranceIdRef.current;
    let finished = false;
    const finish = () => {
      // Only the latest utterance may continue the flow, and only once
      if (finished || id !== utteranceIdRef.current) return;
      finished = true;
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      setIsSpeaking(false);
      if (onEnd) onEnd();
    };

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;

    // Attempt to pick a natural sounding voice for the language
    if (voices.length > 0) {
      const langVoices = voices.filter(v => v.lang.startsWith(language.split('-')[0]));
      // Try to find a female voice or Google/system default
      const preferredVoice = langVoices.find(v => v.name.includes('Google') || v.name.includes('Female')) || langVoices[0];
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
    }

    utterance.onstart = () => { if (id === utteranceIdRef.current) setIsSpeaking(true); };
    utterance.onend = finish;
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') console.error('Speech synthesis error', e);
      finish();
    };

    watchdogRef.current = setTimeout(() => {
      window.speechSynthesis.cancel();
      finish();
    }, WATCHDOG_BASE_MS + text.length * WATCHDOG_MS_PER_CHAR);

    window.speechSynthesis.speak(utterance);
  }, [voices]);

  const stop = useCallback(() => {
    utteranceIdRef.current++; // orphan the current utterance's onEnd
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  return { speak, stop, isSpeaking, voices };
};
