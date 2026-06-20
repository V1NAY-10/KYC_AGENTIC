'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import api from '@/lib/api';
import { useAuth } from '@clerk/nextjs';

type DocType = 'pan' | 'aadhaar' | 'passport';
type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';

interface DocSlot {
  type: DocType;
  label: string;
  hint: string;
  icon: string;
  file: File | null;
  preview: string | null;
  status: UploadStatus;
  cloudUrl: string | null;
  error: string | null;
}

const INITIAL_SLOTS: DocSlot[] = [
  {
    type: 'pan',
    label: 'PAN Card',
    hint: 'Front side only',
    icon: '💳',
    file: null,
    preview: null,
    status: 'idle',
    cloudUrl: null,
    error: null,
  },
  {
    type: 'aadhaar',
    label: 'Aadhaar Card',
    hint: 'Front side (with photo)',
    icon: '🪪',
    file: null,
    preview: null,
    status: 'idle',
    cloudUrl: null,
    error: null,
  },
];

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE_MB = 5;

export default function DocumentUpload() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { language } = useAppStore();
  const isHi = language === 'hi';

  const [slots, setSlots] = useState<DocSlot[]>(INITIAL_SLOTS);
  const [dragOver, setDragOver] = useState<DocType | null>(null);
  const [globalError, setGlobalError] = useState('');

  const fileInputRefs = useRef<Record<DocType, HTMLInputElement | null>>({
    pan: null,
    aadhaar: null,
    passport: null,
  });

  const setSlot = (type: DocType, updates: Partial<DocSlot>) => {
    setSlots(prev => prev.map(s => (s.type === type ? { ...s, ...updates } : s)));
  };

  // ── File selection / validation ───────────────────────────────────────────
  const handleFile = useCallback(async (type: DocType, file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setSlot(type, { error: 'Only JPG, PNG, WebP, or PDF allowed.' });
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setSlot(type, { error: `File must be under ${MAX_SIZE_MB}MB.` });
      return;
    }

    // Build local preview (not for PDFs)
    let preview: string | null = null;
    if (file.type !== 'application/pdf') {
      preview = URL.createObjectURL(file);
    }

    setSlot(type, { file, preview, status: 'uploading', error: null });

    // Upload to backend
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('document', file);
      formData.append('docType', type);

      const res = await api.post('/sessions/upload-document', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      setSlot(type, {
        status: 'done',
        cloudUrl: res.data.url,
        error: null,
      });
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Upload failed. Try again.';
      setSlot(type, { status: 'error', error: msg });
    }
  }, [getToken]);

  // ── Drag-and-drop handlers ────────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent, type: DocType) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(type, file);
  }, [handleFile]);

  const onDragOver = (e: React.DragEvent, type: DocType) => {
    e.preventDefault();
    setDragOver(type);
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleContinue = () => {
    router.push('/onboard/consent');
  };

  const handleSkip = () => {
    router.push('/onboard/consent');
  };

  const hasAnyUploaded = slots.some(s => s.status === 'done');
  const anyUploading   = slots.some(s => s.status === 'uploading');

  return (
    <div className="flex-col flex-center animate-fade-in-up" style={{ width: '100%', maxWidth: '700px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '2rem', marginBottom: '0.75rem' }} className="text-gradient">
          {isHi ? 'दस्तावेज़ अपलोड करें' : 'Upload Documents'}
        </h2>
        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          {isHi
            ? 'आगे बढ़ने के लिए अपने KYC दस्तावेज़ अपलोड करें। यह चरण वैकल्पिक है — आप इसे छोड़ भी सकते हैं।'
            : 'Upload your KYC documents for faster verification. This step is optional — you can skip it and provide them verbally during the call.'}
        </p>

        {/* Optional badge */}
        <span style={{
          display: 'inline-block', marginTop: '0.75rem',
          padding: '4px 14px', borderRadius: '99px',
          background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
          color: 'var(--color-accent-blue)', fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.04em',
        }}>
          OPTIONAL
        </span>
      </div>

      {/* Upload Cards */}
      <div style={{ display: 'flex', gap: '1.5rem', width: '100%', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '2rem' }}>
        {slots.map(slot => (
          <UploadCard
            key={slot.type}
            slot={slot}
            isDragOver={dragOver === slot.type}
            onDrop={(e) => onDrop(e, slot.type)}
            onDragOver={(e) => onDragOver(e, slot.type)}
            onDragLeave={() => setDragOver(null)}
            onClick={() => fileInputRefs.current[slot.type]?.click()}
            onRemove={() => setSlot(slot.type, { file: null, preview: null, status: 'idle', cloudUrl: null, error: null })}
          />
        ))}
      </div>

      {/* Hidden file inputs */}
      {slots.map(slot => (
        <input
          key={slot.type}
          ref={(el) => { fileInputRefs.current[slot.type] = el; }}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(slot.type, file);
            e.target.value = '';
          }}
        />
      ))}

      {/* Format note */}
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '2rem' }}>
        {isHi
          ? 'स्वीकृत प्रारूप: JPG, PNG, WebP, PDF • अधिकतम 5MB प्रति फ़ाइल'
          : 'Accepted formats: JPG, PNG, WebP, PDF • Max 5MB per file'}
      </p>

      {globalError && (
        <div style={{
          marginBottom: '1.5rem', padding: '0.75rem 1rem', borderRadius: '8px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid var(--color-danger)',
          color: 'var(--color-danger)', fontSize: '0.875rem',
        }}>
          {globalError}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '400px' }}>
        <button
          onClick={handleSkip}
          className="btn-secondary"
          style={{
            flex: 1, padding: '0.875rem', borderRadius: '10px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.7)', fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {isHi ? 'छोड़ें →' : 'Skip →'}
        </button>
        <button
          onClick={handleContinue}
          disabled={anyUploading}
          className="btn-primary"
          style={{
            flex: 2, padding: '0.875rem', borderRadius: '10px',
            opacity: anyUploading ? 0.5 : 1,
            cursor: anyUploading ? 'not-allowed' : 'pointer',
            fontSize: '1rem', fontWeight: 600,
          }}
        >
          {anyUploading
            ? (isHi ? 'अपलोड हो रहा है...' : 'Uploading...')
            : hasAnyUploaded
              ? (isHi ? 'जारी रखें ➔' : 'Continue ➔')
              : (isHi ? 'छोड़ें और जारी रखें ➔' : 'Skip & Continue ➔')}
        </button>
      </div>

      <style jsx>{`
        .btn-secondary:hover {
          background: rgba(255,255,255,0.08) !important;
          border-color: rgba(255,255,255,0.2) !important;
          color: white !important;
        }
      `}</style>
    </div>
  );
}

// ── UploadCard sub-component ─────────────────────────────────────────────────
interface UploadCardProps {
  slot: DocSlot;
  isDragOver: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onClick: () => void;
  onRemove: () => void;
}

function UploadCard({ slot, isDragOver, onDrop, onDragOver, onDragLeave, onClick, onRemove }: UploadCardProps) {
  const isDone      = slot.status === 'done';
  const isUploading = slot.status === 'uploading';
  const isError     = slot.status === 'error';

  const borderColor = isDone
    ? 'rgba(34,197,94,0.5)'
    : isError
      ? 'rgba(239,68,68,0.5)'
      : isDragOver
        ? 'rgba(59,130,246,0.6)'
        : 'rgba(255,255,255,0.1)';

  const bgColor = isDone
    ? 'rgba(34,197,94,0.06)'
    : isDragOver
      ? 'rgba(59,130,246,0.08)'
      : 'rgba(255,255,255,0.03)';

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      style={{
        width: '280px', minHeight: '220px',
        border: `2px dashed ${borderColor}`,
        borderRadius: '16px',
        background: bgColor,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem', textAlign: 'center',
        cursor: isDone ? 'default' : 'pointer',
        transition: 'all 0.25s ease',
        position: 'relative',
        transform: isDragOver ? 'scale(1.02)' : 'scale(1)',
      }}
      onClick={isDone || isUploading ? undefined : onClick}
    >
      {/* Remove button */}
      {isDone && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            position: 'absolute', top: '10px', right: '10px',
            width: '26px', height: '26px', borderRadius: '50%',
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
            color: 'var(--color-danger)', cursor: 'pointer', fontSize: '0.8rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}
          title="Remove"
        >
          ✕
        </button>
      )}

      {/* Content */}
      {isUploading ? (
        <UploadingState label={slot.label} />
      ) : isDone && slot.preview ? (
        <DoneStateWithPreview slot={slot} />
      ) : isDone ? (
        <DoneStateNoPreview slot={slot} />
      ) : (
        <IdleState slot={slot} isError={isError} isDragOver={isDragOver} />
      )}
    </div>
  );
}

function UploadingState({ label }: { label: string }) {
  return (
    <>
      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', animation: 'spin 1s linear infinite' }}>⏳</div>
      <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Uploading {label}...</p>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>Please wait</p>
      <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

function DoneStateWithPreview({ slot }: { slot: DocSlot }) {
  return (
    <>
      <img
        src={slot.preview!}
        alt={slot.label}
        style={{ width: '100%', maxHeight: '130px', objectFit: 'cover', borderRadius: '8px', marginBottom: '0.75rem' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-success)', fontWeight: 600, fontSize: '0.9rem' }}>
        <span>✅</span>
        <span>{slot.label} uploaded</span>
      </div>
    </>
  );
}

function DoneStateNoPreview({ slot }: { slot: DocSlot }) {
  return (
    <>
      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
      <p style={{ fontWeight: 600, color: 'var(--color-success)' }}>{slot.label} uploaded</p>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>PDF document</p>
    </>
  );
}

function IdleState({ slot, isError, isDragOver }: { slot: DocSlot; isError: boolean; isDragOver: boolean }) {
  return (
    <>
      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>{slot.icon}</div>
      <p style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem' }}>{slot.label}</p>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>{slot.hint}</p>

      {isError && slot.error ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-danger)', marginBottom: '0.75rem' }}>{slot.error}</p>
      ) : null}

      <div style={{
        padding: '8px 18px', borderRadius: '8px',
        background: isDragOver ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.12)',
        fontSize: '0.82rem', color: isDragOver ? 'var(--color-accent-blue)' : 'rgba(255,255,255,0.6)',
        fontWeight: 500,
      }}>
        {isDragOver ? 'Drop to upload' : 'Click or drag & drop'}
      </div>
    </>
  );
}
