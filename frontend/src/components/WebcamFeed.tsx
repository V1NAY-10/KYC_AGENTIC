import React, { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';

interface WebcamFeedProps {
  onStreamReady: (stream: MediaStream) => void;
  isAgentSpeaking: boolean;
}

export const WebcamFeed: React.FC<WebcamFeedProps> = ({ onStreamReady, isAgentSpeaking }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [faceDetected, setFaceDetected] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectionInterval: NodeJS.Timeout;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        onStreamReady(stream);

        // Load face API model
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

        if (videoRef.current) {
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            // Start face detection loop
            detectionInterval = setInterval(async () => {
              if (videoRef.current) {
                const detections = await faceapi.detectAllFaces(
                  videoRef.current,
                  new faceapi.TinyFaceDetectorOptions()
                );
                setFaceDetected(detections.length > 0);
              }
            }, 1000);
          };
        }
      } catch (err) {
        console.error('Camera Error:', err);
        setError('Camera or Microphone access denied.');
      }
    };

    startCamera();

    return () => {
      if (detectionInterval) clearInterval(detectionInterval);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [onStreamReady]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-red-500 bg-red-500/10 p-4 text-center">
          {error}
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted // Muted to prevent echo, stream still has audio track for recognition
          className={`w-full h-full object-cover transition-opacity duration-500 ${isAgentSpeaking ? 'opacity-70' : 'opacity-100'}`}
        />
      )}
      
      {/* Face Detection Overlay Box */}
      <div 
        className="absolute inset-0 pointer-events-none flex items-center justify-center transition-all duration-300"
      >
        <div 
          style={{ width: '40%', height: '60%' }} 
          className={`border-2 rounded-full transition-colors duration-500 shadow-lg ${
            faceDetected ? 'border-green-500/50 shadow-green-500/20' : 'border-red-500/50 border-dashed shadow-red-500/20'
          }`}
        />
      </div>

      {/* Face Status Indicator */}
      <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-medium border border-white/10">
        <div className={`w-2 h-2 rounded-full ${faceDetected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-white/80">{faceDetected ? 'Face Detected' : 'Position face in frame'}</span>
      </div>
    </div>
  );
};
