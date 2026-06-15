'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as faceapi from 'face-api.js';

type CheckStatus = 'pending' | 'checking' | 'success' | 'error';

export default function SystemCheck() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [cameraStatus, setCameraStatus] = useState<CheckStatus>('pending');
  const [micStatus, setMicStatus] = useState<CheckStatus>('pending');
  const [faceStatus, setFaceStatus] = useState<CheckStatus>('pending');
  const [speechStatus, setSpeechStatus] = useState<CheckStatus>('pending');
  
  const [errorMessage, setErrorMessage] = useState('');

  const allClear = 
    cameraStatus === 'success' && 
    micStatus === 'success' && 
    faceStatus === 'success' && 
    speechStatus === 'success';

  useEffect(() => {
    runChecks();
    // Cleanup stream on unmount
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const runChecks = async () => {
    setErrorMessage('');
    
    // 1. Check Speech Recognition (Chrome/Edge only)
    setSpeechStatus('checking');
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechStatus('error');
      setErrorMessage('Speech Recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      return;
    }
    setSpeechStatus('success');

    // 2. Request Camera & Mic Permissions
    setCameraStatus('checking');
    setMicStatus('checking');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraStatus('success');
      setMicStatus('success');
    } catch (err) {
      console.error(err);
      setCameraStatus('error');
      setMicStatus('error');
      setErrorMessage('Camera or Microphone access denied. Please allow permissions in your browser and try again.');
      return;
    }

    // 3. Load face-api models and check for a face
    setFaceStatus('checking');
    try {
      // Using jsdelivr CDN for face-api models to avoid local hosting complexities
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      
      // Wait for video to start playing
      if (videoRef.current) {
        videoRef.current.onloadedmetadata = async () => {
          videoRef.current?.play();
          
          // Give it a second to focus
          setTimeout(async () => {
            if (videoRef.current) {
              const detections = await faceapi.detectAllFaces(
                videoRef.current, 
                new faceapi.TinyFaceDetectorOptions()
              );
              
              if (detections.length > 0) {
                setFaceStatus('success');
              } else {
                setFaceStatus('error');
                setErrorMessage('No face detected. Please ensure your face is clearly visible in the camera.');
              }
            }
          }, 1500);
        };
      }
    } catch (err) {
      console.error('Face API Error:', err);
      setFaceStatus('error');
      setErrorMessage('Failed to load face detection models. Please check your connection.');
    }
  };

  return (
    <div className="flex-col flex-center animate-fade-in-up" style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }} className="text-gradient">
        System Check
      </h2>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: '2rem', textAlign: 'center' }}>
        We need to ensure your device is ready for the AI video call.
      </p>

      <div style={{ display: 'flex', gap: '2rem', width: '100%', flexWrap: 'wrap' }}>
        {/* Left Side: Video Preview */}
        <div className="glass-card" style={{ flex: '1', minWidth: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ 
            width: '100%', 
            aspectRatio: '4/3', 
            backgroundColor: '#000', 
            borderRadius: '8px', 
            overflow: 'hidden',
            position: 'relative'
          }}>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Simple face target overlay */}
            <div style={{
              position: 'absolute',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '50%', height: '60%',
              border: `2px dashed ${faceStatus === 'success' ? 'var(--color-success)' : 'rgba(255,255,255,0.3)'}`,
              borderRadius: '50%',
              transition: 'border-color 0.3s ease'
            }} />
          </div>
        </div>

        {/* Right Side: Checklists */}
        <div className="glass-card" style={{ flex: '1', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Status Checklist</h3>
          
          <CheckItem label="Browser Compatibility" status={speechStatus} />
          <CheckItem label="Camera Access" status={cameraStatus} />
          <CheckItem label="Microphone Access" status={micStatus} />
          <CheckItem label="Face Detected" status={faceStatus} />
          
          {errorMessage && (
            <div style={{ 
              marginTop: '1rem', 
              padding: '1rem', 
              backgroundColor: 'rgba(239, 68, 68, 0.1)', 
              border: '1px solid var(--color-danger)', 
              borderRadius: '8px',
              color: 'var(--color-danger)',
              fontSize: '0.875rem'
            }}>
              {errorMessage}
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '2rem', display: 'flex', gap: '1rem' }}>
            <button 
              className="btn-primary" 
              style={{ flex: 1, backgroundColor: 'transparent', border: '1px solid var(--color-border)' }}
              onClick={runChecks}
            >
              Retry
            </button>
            <button 
              className="btn-primary" 
              style={{ flex: 2, opacity: allClear ? 1 : 0.5, cursor: allClear ? 'pointer' : 'not-allowed' }}
              onClick={() => { if (allClear) router.push('/onboard/consent'); }}
              disabled={!allClear}
            >
              I'm Ready ➔
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckItem({ label, status }: { label: string, status: CheckStatus }) {
  let icon = '⏳';
  let color = 'var(--color-text-secondary)';
  
  if (status === 'checking') {
    icon = '🔄';
    color = 'var(--color-accent-blue)';
  } else if (status === 'success') {
    icon = '✅';
    color = 'var(--color-success)';
  } else if (status === 'error') {
    icon = '❌';
    color = 'var(--color-danger)';
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <span style={{ color }}>{icon}</span>
    </div>
  );
}
