import { useState, useEffect, useRef, useCallback } from 'react';

export const useSpeechRecognition = (language: string = 'en-US') => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = language;

        recognition.onstart = () => {
          setIsListening(true);
        };

        recognition.onresult = (event: any) => {
          let currentTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              currentTranscript += event.results[i][0].transcript;
            }
          }
          if (currentTranscript) {
            setTranscript((prev) => prev + (prev ? ' ' : '') + currentTranscript.trim());
          }
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error', event.error);
          // Don't auto-restart if permission was denied or blocked
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            shouldListenRef.current = false;
            setIsListening(false);
          }
        };

        recognition.onend = () => {
          // If we should be listening, auto-restart speech recognition after a short delay
          if (shouldListenRef.current) {
            console.log('Speech recognition ended unexpectedly. Restarting...');
            setTimeout(() => {
              if (shouldListenRef.current && recognitionRef.current) {
                try {
                  recognitionRef.current.start();
                } catch (e) {
                  console.error('Failed to restart speech recognition', e);
                  setIsListening(false);
                }
              }
            }, 100);
          } else {
            setIsListening(false);
          }
        };
      } else {
        console.warn("Speech recognition not supported in this browser.");
      }
    }

    return () => {
      if (recognitionRef.current) {
        const rec = recognitionRef.current;
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.stop();
        } catch (e) {
          console.error('Error stopping recognition during cleanup', e);
        }
      }
    };
  }, [language]);

  const startListening = useCallback(() => {
    shouldListenRef.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error('Could not start listening', e);
      }
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error('Could not stop listening', e);
      }
      setIsListening(false);
    }
  }, []);

  const resetTranscript = useCallback(() => setTranscript(''), []);

  return { isListening, transcript, startListening, stopListening, resetTranscript };
};
