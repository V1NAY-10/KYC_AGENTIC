'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KYCField {
  key: string;
  label: string;
  section: 'personal' | 'financial' | 'loan';
  aiExtractedValue: string | number | null;
  finalValue: string | number | null;
  confidence: number;
  isFlagged: boolean;
  isEdited: boolean;
  isLocked?: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const SECTION_CONFIG: Record<'personal' | 'financial' | 'loan', {
  label: string; icon: string; accentColor: string;
}> = {
  personal:  { label: 'Personal Information', icon: '👤', accentColor: '#7C3AED' },
  financial: { label: 'Financial Details',    icon: '💰', accentColor: '#1D4ED8' },
  loan:      { label: 'Loan Details',         icon: '🏦', accentColor: '#059669' },
};

// ─── Confidence dot ───────────────────────────────────────────────────────────

function ConfDot({ confidence }: { confidence: number }) {
  const pct = Math.round((confidence ?? 0) * 100);
  const cls = pct >= 80 ? 'conf-high' : pct >= 60 ? 'conf-medium' : 'conf-low';
  const title = `Confidence: ${pct}%`;
  return <span className={`conf-dot ${cls}`} title={title} style={{ display: 'inline-block' }} />;
}

// ─── Single editable field row ────────────────────────────────────────────────

function FieldRow({ field, onEdit }: { field: KYCField; onEdit: (key: string, value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(field.finalValue ?? field.aiExtractedValue ?? ''));

  const handleSave = () => { onEdit(field.key, inputVal); setEditing(false); };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  };

  const displayValue = field.finalValue ?? field.aiExtractedValue;
  const isEmpty = displayValue == null || displayValue === '';

  const rowClass = `pdf-field-row${field.isEdited ? ' edited' : field.isFlagged ? ' flagged' : ''}`;

  return (
    <div className={rowClass}>
      <span className="pdf-field-label">{field.label}</span>

      {editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            autoFocus
            className="pdf-field-input"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={handleSave}
            style={{
              padding: '3px 10px', borderRadius: '5px',
              background: '#1d4ed8', color: 'white',
              border: 'none', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: '700',
              whiteSpace: 'nowrap',
            }}
          >Save</button>
          <button
            onClick={() => setEditing(false)}
            style={{
              padding: '3px 8px', borderRadius: '5px',
              background: 'none', color: '#94a3b8',
              border: '1px solid #e2e8f0', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: '600',
            }}
          >✕</button>
        </div>
      ) : (
        <span className="pdf-field-value" style={{ color: isEmpty ? '#94a3b8' : '#0f172a', fontStyle: isEmpty ? 'italic' : 'normal' }}>
          {isEmpty ? 'Not provided' : String(displayValue)}
        </span>
      )}

      {/* Right column: confidence + edit button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
        <ConfDot confidence={field.confidence} />
        {field.isFlagged && (
          <span style={{ fontSize: '0.55rem', fontWeight: '700', color: '#b45309', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '3px', padding: '1px 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Low Conf
          </span>
        )}
        {field.isEdited && (
          <span style={{ fontSize: '0.55rem', fontWeight: '700', color: '#1d4ed8', background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: '3px', padding: '1px 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Edited
          </span>
        )}
        {!field.isLocked && !editing && (
          <button className="pdf-edit-btn" onClick={() => { setInputVal(String(displayValue ?? '')); setEditing(true); }}>
            ✏ Edit
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type PagePhase = 'review' | 'submitting' | 'decision';

export default function ReviewPage() {
  const router = useRouter();
  const { sessionId, reset } = useAppStore();

  const [fields, setFields] = useState<KYCField[]>([]);
  const [storedSessionId, setStoredSessionId] = useState<string>('');
  const [phase, setPhase] = useState<PagePhase>('review');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Load from sessionStorage ──────────────────────────────────────────────
  useEffect(() => {
    const raw = sessionStorage.getItem('kycReviewData');
    if (!raw) { router.push('/onboard/setup'); return; }
    try {
      const parsed = JSON.parse(raw) as { extractedFields?: KYCField[]; sessionId?: string };
      setFields(parsed.extractedFields ?? []);
      setStoredSessionId(parsed.sessionId ?? sessionId ?? '');
    } catch {
      router.push('/onboard/setup');
    }
  }, [router, sessionId]);

  // ── Edit handler ──────────────────────────────────────────────────────────
  const handleEdit = useCallback((key: string, value: string) => {
    setFields(prev => prev.map(f => f.key === key ? { ...f, finalValue: value, isEdited: true } : f));
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    setPhase('submitting');
    const sid = storedSessionId || sessionId;
    if (!sid) { setSubmitError('Session ID missing. Please restart.'); setPhase('review'); return; }
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
      const res = await fetch(`${API_URL}/sessions/${sid}/submit-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ extractedFields: fields }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || 'Submission failed.');
      }
      setPhase('decision');
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setPhase('review');
    }
  }, [fields, storedSessionId, sessionId]);

  // ── Download PDF ──────────────────────────────────────────────────────────
  const handleDownload = () => { window.print(); };

  // ── Derived ───────────────────────────────────────────────────────────────
  const fieldsBySection = {
    personal:  fields.filter(f => f.section === 'personal'),
    financial: fields.filter(f => f.section === 'financial'),
    loan:      fields.filter(f => f.section === 'loan'),
  };
  const editedCount  = fields.filter(f => f.isEdited).length;
  const flaggedCount = fields.filter(f => f.isFlagged).length;
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const refNo = storedSessionId ? storedSessionId.slice(-8).toUpperCase() : 'PENDING';

  // ─────────────────────────────────────────────────────────────────────────
  // SUBMITTING
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'submitting') {
    return (
      <div style={{
        minHeight: '100vh', background: '#080B14',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-family)',
      }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ position: 'relative', width: '72px', height: '72px' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid rgba(59,130,246,0.15)' }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid transparent', borderTopColor: '#3B82F6', animation: 'spin 0.9s linear infinite' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>🏦</div>
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>Processing Application</h2>
            <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.45)' }}>Running AI loan evaluation…</p>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUCCESS
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'decision') {
    return (
      <div style={{
        minHeight: '100vh', background: '#080B14',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-family)', padding: '2rem',
      }}>
        {/* ambient glow */}
        <div style={{ position: 'fixed', top: '-20%', right: '-10%', width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 65%)', pointerEvents: 'none', zIndex: 0 }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: '480px' }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '50%', margin: '0 auto 1.5rem',
            background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(59,130,246,0.15))',
            border: '2px solid rgba(16,185,129,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.25rem',
            boxShadow: '0 0 40px rgba(16,185,129,0.2)',
          }}>✅</div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: 'var(--color-text-primary)', letterSpacing: '-0.5px', marginBottom: '0.75rem' }}>
            Application Submitted!
          </h1>
          <p style={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, marginBottom: '2rem' }}>
            Your loan application is under review by our Loan Officers. We will contact you with an update shortly.
          </p>
          {/* Reference chip */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '2rem', padding: '8px 16px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontWeight: '600' }}>Reference</span>
            <span style={{ fontSize: '0.875rem', fontFamily: 'monospace', color: 'var(--color-accent-blue)', fontWeight: '700' }}>#{refNo}</span>
          </div>
          <br />
          <button
            style={{
              padding: '12px 28px', borderRadius: '11px',
              background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
              color: 'white', fontSize: '0.9375rem', fontWeight: '700', border: 'none', cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(59,130,246,0.3)',
            }}
            onClick={() => { sessionStorage.removeItem('kycReviewData'); reset(); router.push('/'); }}
          >
            Return to Home →
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REVIEW — PDF Document
  // ─────────────────────────────────────────────────────────────────────────
  if (fields.length === 0) {
    return (
      <div style={{ minHeight: '100vh', background: '#080B14', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-family)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
          <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid #3B82F6', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: '0.875rem' }}>Loading your application…</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="pdf-print-root pdf-outer">

      {/* ── Action bar (hidden on print) ── */}
      <div className="pdf-action-bar" style={{
        position: 'relative', zIndex: 2,
        maxWidth: '800px', margin: '0 auto 1.25rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '0.75rem',
      }}>
        {/* Left: stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
            {fields.length} fields extracted
          </div>
          {flaggedCount > 0 && (
            <div style={{ padding: '5px 12px', borderRadius: '20px', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.3)', fontSize: '0.75rem', color: '#FCD34D' }}>
              ⚠️ {flaggedCount} low-confidence field{flaggedCount > 1 ? 's' : ''}
            </div>
          )}
          {editedCount > 0 && (
            <div style={{ padding: '5px 12px', borderRadius: '20px', background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.3)', fontSize: '0.75rem', color: '#60A5FA' }}>
              ✏️ {editedCount} edited
            </div>
          )}
        </div>

        {/* Right: Download */}
        <button
          onClick={handleDownload}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '8px 18px', borderRadius: '9px',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.75)', fontSize: '0.8125rem', fontWeight: '600', cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download PDF
        </button>
      </div>

      {/* ── The paper document ── */}
      <div className="pdf-document">

        {/* Top gradient stripe */}
        <div className="pdf-header-stripe" />

        {/* Document header */}
        <div className="pdf-body" style={{ paddingBottom: '1.5rem', borderBottom: '2px solid #e8edf8' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            {/* Logo + title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
              <div style={{
                width: '42px', height: '42px', borderRadius: '10px',
                background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <span style={{ color: 'white', fontWeight: '900', fontSize: '1.25rem', letterSpacing: '-1px' }}>A</span>
              </div>
              <div>
                <div style={{ fontSize: '0.6875rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '3px' }}>
                  Aria KYC System
                </div>
                <h1 style={{ fontSize: '1.3125rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.4px', lineHeight: 1 }}>
                  Personal Loan Application
                </h1>
              </div>
            </div>
            {/* Meta info */}
            <div style={{ textAlign: 'right', fontSize: '0.75rem', color: '#64748b', lineHeight: 1.9 }}>
              <div style={{ fontWeight: '700', color: '#0f172a', fontFamily: 'monospace', letterSpacing: '0.02em' }}>
                Ref: #{refNo}
              </div>
              <div>Date: {today}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 10px', borderRadius: '20px', background: '#f1f5ff', border: '1px solid #c7d7fd', color: '#1d4ed8', fontWeight: '700', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                ● AI Interview Verified
              </div>
            </div>
          </div>
          {/* Sub-title */}
          <p style={{ marginTop: '1rem', fontSize: '0.8125rem', color: '#64748b', lineHeight: 1.6 }}>
            The following information was extracted from your AI-assisted video interview with Aria.
            Please review all fields carefully and correct any errors before submitting.
            Fields marked <span style={{ color: '#b45309', fontWeight: '600' }}>LOW CONF</span> should be verified.
          </p>
        </div>

        {/* ── Sections ── */}
        <div className="pdf-body" style={{ paddingTop: '1.75rem', paddingBottom: '2rem' }}>
          {(Object.keys(SECTION_CONFIG) as Array<'personal' | 'financial' | 'loan'>).map((sec, secIdx) => {
            const cfg = SECTION_CONFIG[sec];
            const sectionFields = fieldsBySection[sec];
            if (sectionFields.length === 0) return null;
            return (
              <div key={sec} style={{ marginBottom: secIdx < 2 ? '2rem' : 0 }}>
                {/* Section header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.75rem' }}>
                  <div style={{
                    width: '4px', height: '18px', borderRadius: '2px',
                    background: cfg.accentColor, flexShrink: 0
                  }} />
                  <span style={{ fontSize: '1rem' }}>{cfg.icon}</span>
                  <h2 className="pdf-section-title" style={{ flex: 1, color: cfg.accentColor }}>
                    {cfg.label}
                  </h2>
                  <span style={{ fontSize: '0.6875rem', color: '#94a3b8', fontWeight: '600' }}>
                    {sectionFields.length} fields
                  </span>
                </div>
                {/* Field rows */}
                <div>
                  {sectionFields.map(field => (
                    <FieldRow key={field.key} field={field} onEdit={handleEdit} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Document footer ── */}
        <div className="pdf-footer">
          <span style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>
            Generated by Aria KYC System · Confidential
          </span>
          <span style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>
            {fields.length} fields · {editedCount > 0 ? `${editedCount} edited` : 'No edits'}
          </span>
        </div>
      </div>

      {/* ── Error ── */}
      {submitError && (
        <div style={{
          maxWidth: '800px', margin: '1rem auto 0',
          padding: '12px 16px', borderRadius: '10px',
          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#FCA5A5', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '1.125rem', flexShrink: 0 }}>⚠️</span>
          {submitError}
        </div>
      )}

      {/* ── Action buttons (hidden on print) ── */}
      <div className="pdf-action-bar" style={{
        maxWidth: '800px', margin: '1.25rem auto 0',
        display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap',
      }}>
        <button
          onClick={() => { sessionStorage.removeItem('kycReviewData'); reset(); router.push('/'); }}
          style={{
            padding: '11px 22px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.6)', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#fff'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.6)'}
        >
          ✕ Cancel
        </button>
        <button
          id="confirm-submit-btn"
          onClick={handleSubmit}
          style={{
            padding: '11px 28px', borderRadius: '10px',
            background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
            color: 'white', fontSize: '0.875rem', fontWeight: '700',
            border: 'none', cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(29,78,216,0.35)',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            transition: 'box-shadow 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 28px rgba(29,78,216,0.5)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(29,78,216,0.35)'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Confirm &amp; Submit Application
        </button>
      </div>

      <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '0.6875rem', marginTop: '1.5rem', position: 'relative', zIndex: 1 }}>
        All edits are saved locally · Submitting triggers the loan evaluation engine
      </p>
    </div>
  );
}
