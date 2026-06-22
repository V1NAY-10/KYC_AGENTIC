import React, { useRef, useEffect } from 'react';

interface WaveformVisualizerProps {
  stream: MediaStream | null;
  isActive: boolean;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({ stream, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const resumeCtx = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().then(() => {
          console.log('[WaveformVisualizer] AudioContext resumed via click');
        });
      }
    };
    window.addEventListener('click', resumeCtx);
    window.addEventListener('touchstart', resumeCtx);
    return () => {
      window.removeEventListener('click', resumeCtx);
      window.removeEventListener('touchstart', resumeCtx);
    };
  }, []);

  useEffect(() => {
    if (!stream || !isActive) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // Draw flat line
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.beginPath();
          ctx.moveTo(0, canvas.height / 2);
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();
        }
      }
      return;
    }

    // Initialize Web Audio API
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    const audioCtx = audioContextRef.current;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {
        console.log('[WaveformVisualizer] AudioContext resumed successfully');
      }).catch(err => {
        console.warn('[WaveformVisualizer] AudioContext resume failed:', err);
      });
    }
    
    // Only create a new source if we haven't already
    if (!analyserRef.current) {
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current!;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; // slight trail effect
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3b82f6'; // blue-500
      ctx.beginPath();

      const sliceWidth = (canvas.width * 1.0) / dataArray.length;
      let x = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [stream, isActive]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={60}
      className="w-full h-16 rounded-lg bg-gray-900 shadow-inner"
    />
  );
};
