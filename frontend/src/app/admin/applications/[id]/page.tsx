'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';

/* ─── Types ───────────────────────────────────────────────────── */
interface FraudSignal {
  type: string;
  severity: string;
  description: string;
}
interface ExtractedField {
  key: string;
  label?: string;
  finalValue?: string;
  aiExtractedValue?: string;
  isEdited?: boolean;
}
interface LoanDecision {
  score?: number;
  decision?: string;
  llmAssessment?: {
    summary?: string;
    strengths?: string[];
    risks?: string[];
  };
}
interface ApplicationSession {
  loanDecision?: LoanDecision;
  fraudSignals?: FraudSignal[];
  extractedAnswers?: ExtractedField[];
}
interface ApplicationData {
  _id: string;
  referenceNumber: string;
  status: string;
  createdAt: string;
  officerNote?: string;
  userId?: { name?: string; email?: string };
  sessionId?: ApplicationSession;
}

/* ─── Score Ring ──────────────────────────────────────────────── */
function ScoreRing({ score }: { score: number }) {
  const r = 45;
  const circ = 2 * Math.PI * r; // ≈ 283
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? '#10B981' : score >= 40 ? '#F59E0B' : '#EF4444';
  const label = score >= 70 ? 'Strong' : score >= 40 ? 'Moderate' : 'Weak';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{ position: 'relative', width: '110px', height: '110px' }}>
        <svg width="110" height="110" viewBox="0 0 110 110" style={{ transform: 'rotate(-90deg)' }}>
          {/* Track */}
          <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          {/* Progress */}
          <circle
            cx="55" cy="55" r={r} fill="none"
            stroke={color} strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{
              transition: 'stroke-dashoffset 1s ease-out, stroke 0.3s ease',
              filter: `drop-shadow(0 0 6px ${color}80)`
            }}
          />
        </svg>
        {/* Center text */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '2px'
        }}>
          <span style={{ fontSize: '1.625rem', fontWeight: '800', color, lineHeight: 1 }}>{score}</span>
          <span style={{ fontSize: '0.6rem', fontWeight: '600', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>/ 100</span>
        </div>
      </div>
      <span style={{
        fontSize: '0.7rem', fontWeight: '700', padding: '2px 10px', borderRadius: '20px',
        background: `${color}18`, color, border: `1px solid ${color}40`,
        textTransform: 'uppercase', letterSpacing: '0.08em'
      }}>{label}</span>
    </div>
  );
}

/* ─── Section Panel ───────────────────────────────────────────── */
function Panel({ title, icon, glow, children, delay = '0s' }: {
  title: string; icon: React.ReactNode; glow?: string; children: React.ReactNode; delay?: string;
}) {
  return (
    <section className={`admin-glass panel-in ${glow ?? ''}`} style={{
      overflow: 'hidden', animationDelay: delay, opacity: 0
    }}>
      <div style={{
        padding: '0.875rem 1.25rem',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: '0.625rem',
        background: 'rgba(255,255,255,0.02)'
      }}>
        {icon}
        <h2 style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--color-text-primary)' }}>{title}</h2>
      </div>
      <div style={{ padding: '1.25rem' }}>{children}</div>
    </section>
  );
}

/* ─── Severity badge ──────────────────────────────────────────── */
function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'high' ? 'badge-severity-high' : severity === 'medium' ? 'badge-severity-medium' : 'badge-severity-low';
  return (
    <span className={cls} style={{ fontSize: '0.65rem', fontWeight: '700', padding: '2px 7px', borderRadius: '5px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {severity}
    </span>
  );
}

/* ─── Page ────────────────────────────────────────────────────── */
export default function ApplicationDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const [app, setApp] = useState<ApplicationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [decision, setDecision] = useState('');
  const [officerNote, setOfficerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { router.push('/sign-in?redirect_url=/admin'); return; }

    const fetchApp = async () => {
      try {
        const token = await getToken();
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
        const res = await fetch(`${API_URL}/admin/applications/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch application');
        const data = await res.json();
        setApp(data.application);
        const s = data.application.status;
        setDecision(s === 'under_review' || s === 'submitted' ? '' : s);
        setOfficerNote(data.application.officerNote || '');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error loading application');
      } finally {
        setLoading(false);
      }
    };
    fetchApp();
  }, [id, isLoaded, isSignedIn, getToken, router]);

  const handleSubmitDecision = async () => {
    if (!decision) { setSubmitError('Please select a decision.'); return; }
    setSubmitting(true); setSubmitError('');
    try {
      const token = await getToken();
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
      const res = await fetch(`${API_URL}/admin/applications/${id}/decision`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: decision, officerDecision: decision, officerNote })
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to update decision'); }
      setSubmitted(true);
      setTimeout(() => router.push('/admin'), 1500);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Error saving decision');
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── Loading ── */
  if (loading || !isLoaded) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="skeleton" style={{ height: '24px', width: '160px', borderRadius: '8px' }} />
      <div className="skeleton" style={{ height: '80px', borderRadius: '16px' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.25rem' }}>
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '200px', borderRadius: '16px' }} />)}
      </div>
    </div>
  );

  if (error || !app) return (
    <div style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#EF4444', fontSize: '0.875rem' }}>
      <strong>Error: </strong>{error || 'Application not found'}
    </div>
  );

  const session:      ApplicationSession = app.sessionId || {};
  const loanDecision: LoanDecision        = session.loanDecision || {};
  const fraudSignals: FraudSignal[]       = session.fraudSignals || [];
  const fields:       ExtractedField[]    = session.extractedAnswers || [];

  const aiRec = loanDecision.decision;
  const aiRecMap: Record<string, { color: string; bg: string; label: string }> = {
    approved:    { color: '#10B981', bg: 'rgba(16,185,129,0.10)',  label: 'Recommend Approval' },
    rejected:    { color: '#EF4444', bg: 'rgba(239,68,68,0.08)',   label: 'Recommend Rejection' },
    conditional: { color: '#3B82F6', bg: 'rgba(59,130,246,0.08)', label: 'Conditional Approval' },
  };
  const aiStyle = aiRecMap[aiRec] ?? { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', label: 'Under Review' };

  const statusMap: Record<string, { color: string }> = {
    submitted:    { color: '#F59E0B' },
    under_review: { color: '#F59E0B' },
    approved:     { color: '#10B981' },
    rejected:     { color: '#EF4444' },
    conditional:  { color: '#3B82F6' },
  };
  const statusColor = statusMap[app.status]?.color ?? 'var(--color-text-secondary)';

  return (
    <div style={{ paddingBottom: '6rem' }}>

      {/* ── Back ── */}
      <Link href="/admin" style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
        color: 'var(--color-text-secondary)', textDecoration: 'none',
        fontSize: '0.8125rem', fontWeight: '500', marginBottom: '1.5rem',
        transition: 'color 0.15s',
      }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.15s' }}>
          <path d="m15 18-6-6 6-6"/>
        </svg>
        Back to Applications
      </Link>

      {/* ── Page header ── */}
      <div className="panel-in" style={{
        opacity: 0,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '1rem',
        marginBottom: '1.75rem', paddingBottom: '1.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.07)'
      }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--color-text-primary)', letterSpacing: '-0.4px', marginBottom: '0.375rem' }}>
            Application{' '}
            <span style={{ color: 'var(--color-accent-blue)', fontFamily: 'monospace' }}>#{app.referenceNumber}</span>
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: '500' }}>{app.userId?.name}</span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span>{app.userId?.email}</span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span>{new Date(app.createdAt).toLocaleString()}</span>
          </div>
        </div>
        {/* Current status pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '6px 14px', borderRadius: '9px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
        }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
          <span style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--color-text-primary)', textTransform: 'capitalize' }}>
            {app.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>

        {/* ── Column 1: AI Assessment ── */}
        <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          <Panel title="AI Loan Assessment" delay="0.05s" icon={
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" style={{ color: '#3B82F6' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/>
              <path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
            </svg>
          }>
            {loanDecision.score !== undefined ? (
              <div>
                {/* Score + recommendation banner */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'center',
                  marginBottom: '1.25rem', paddingBottom: '1.25rem',
                  borderBottom: '1px solid rgba(255,255,255,0.06)'
                }}>
                  <ScoreRing score={loanDecision.score} />
                  <div style={{ flex: 1, minWidth: '180px' }}>
                    {/* Recommendation banner */}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                      padding: '5px 12px', borderRadius: '8px',
                      background: aiStyle.bg, border: `1px solid ${aiStyle.color}30`,
                      marginBottom: '0.75rem',
                    }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: '700', color: aiStyle.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        AI: {aiStyle.label}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.6, fontStyle: 'italic' }}>
                      &ldquo;{loanDecision.llmAssessment?.summary}&rdquo;
                    </p>
                  </div>
                </div>

                {/* Strengths + Risks */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.75rem' }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" style={{ color: '#10B981', flexShrink: 0 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                        <path d="m9 12 2 2 4-4"/>
                      </svg>
                      <span style={{ fontSize: '0.7rem', fontWeight: '700', color: '#10B981', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Strengths</span>
                    </div>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {loanDecision.llmAssessment?.strengths?.map((s: string, i: number) => (
                        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                          <span style={{ color: '#10B981', marginTop: '3px', flexShrink: 0 }}>&#10003;</span>
                          {s}
                        </li>
                      )) ?? <li style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>No specific strengths noted.</li>}
                    </ul>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.75rem' }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" style={{ color: '#EF4444', flexShrink: 0 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>
                      </svg>
                      <span style={{ fontSize: '0.7rem', fontWeight: '700', color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Risks</span>
                    </div>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {loanDecision.llmAssessment?.risks?.map((r: string, i: number) => (
                        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                          <span style={{ color: '#EF4444', marginTop: '3px', flexShrink: 0 }}>&#10007;</span>
                          {r}
                        </li>
                      )) ?? <li style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>No specific risks noted.</li>}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>No AI evaluation available for this application.</p>
            )}
          </Panel>

          {/* ── KYC Data ── */}
          <Panel title="Extracted KYC Data" delay="0.10s" icon={
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" style={{ color: '#8B5CF6' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/>
              <line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>
            </svg>
          }>
            {fields.length === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>No KYC data extracted.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {fields.map((f: ExtractedField, i: number) => (
                  <div key={i} style={{
                    padding: '0.75rem', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', flexDirection: 'column', gap: '4px'
                  }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: '600', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {f.label || f.key}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: '600', color: f.finalValue || f.aiExtractedValue ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>
                        {f.finalValue || f.aiExtractedValue || <em style={{ fontStyle: 'italic', fontWeight: 400, color: 'var(--color-text-secondary)' }}>Not provided</em>}
                      </span>
                      {f.isEdited && (
                        <span style={{
                          fontSize: '0.6rem', fontWeight: '700', padding: '1px 6px', borderRadius: '5px',
                          background: 'rgba(59,130,246,0.12)', color: 'var(--color-accent-blue)',
                          border: '1px solid rgba(59,130,246,0.25)', textTransform: 'uppercase', letterSpacing: '0.06em'
                        }}>Edited</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* ── Column 2: Fraud + Decision ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Fraud Signals */}
          <Panel title="Fraud & Compliance" delay="0.15s" icon={
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" style={{ color: '#EF4444' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
              <line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>
            </svg>
          }>
            {fraudSignals.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {fraudSignals.map((sig: FraudSignal, i: number) => (
                  <div key={i} style={{
                    padding: '0.75rem', borderRadius: '10px',
                    background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)',
                    display: 'flex', flexDirection: 'column', gap: '4px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#EF4444', textTransform: 'capitalize' }}>
                        {sig.type}
                      </span>
                      <SeverityBadge severity={sig.severity} />
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                      {sig.description}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '8px',
                  background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" style={{ color: '#10B981' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
                <span style={{ fontSize: '0.8125rem', color: '#10B981', fontWeight: '500' }}>No fraud signals detected.</span>
              </div>
            )}
          </Panel>

          {/* Officer Decision — sticky */}
          <div className="panel-in panel-in-4" style={{ animationDelay: '0.20s', opacity: 0, position: 'sticky', top: '80px' }}>
            <section style={{
              borderRadius: '16px', overflow: 'hidden',
              border: '1px solid rgba(59,130,246,0.25)',
              background: 'rgba(59,130,246,0.04)',
              boxShadow: '0 0 30px rgba(59,130,246,0.08)'
            }}>
              <div style={{
                padding: '0.875rem 1.25rem',
                borderBottom: '1px solid rgba(59,130,246,0.15)',
                display: 'flex', alignItems: 'center', gap: '0.625rem',
                background: 'rgba(59,130,246,0.07)'
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" style={{ color: '#60A5FA' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>
                </svg>
                <h2 style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#DBEAFE' }}>Officer Decision</h2>
              </div>

              <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Decision select */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                    Final Status
                  </label>
                  <select
                    value={decision}
                    onChange={e => setDecision(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: '9px',
                      background: 'rgba(8,11,20,0.8)', border: '1px solid rgba(255,255,255,0.10)',
                      color: 'var(--color-text-primary)', fontSize: '0.875rem', outline: 'none',
                      cursor: 'pointer', transition: 'border-color 0.15s',
                      appearance: 'none',
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)')}
                  >
                    <option value="" disabled>Select decision…</option>
                    <option value="approved">✓ Approve</option>
                    <option value="conditional">◎ Conditional Approval</option>
                    <option value="rejected">✕ Reject</option>
                    <option value="docs_requested">⊡ Request Documents</option>
                  </select>
                </div>

                {/* Note textarea */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                    Internal Note
                  </label>
                  <textarea
                    value={officerNote}
                    onChange={e => setOfficerNote(e.target.value)}
                    placeholder="Justification, conditions, or remarks…"
                    rows={4}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: '9px',
                      background: 'rgba(8,11,20,0.8)', border: '1px solid rgba(255,255,255,0.10)',
                      color: 'var(--color-text-primary)', fontSize: '0.875rem', outline: 'none',
                      resize: 'none', transition: 'border-color 0.15s', lineHeight: 1.6,
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)')}
                  />
                </div>

                {/* Error */}
                {submitError && (
                  <div style={{
                    padding: '8px 12px', borderRadius: '9px',
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                    color: '#EF4444', fontSize: '0.8rem'
                  }}>{submitError}</div>
                )}

                {/* Submit button */}
                <button
                  onClick={handleSubmitDecision}
                  disabled={submitting || submitted}
                  style={{
                    width: '100%', padding: '10px', borderRadius: '9px',
                    background: submitted
                      ? 'rgba(16,185,129,0.15)'
                      : 'linear-gradient(135deg, #2563EB, #3B82F6)',
                    border: submitted ? '1px solid rgba(16,185,129,0.3)' : 'none',
                    color: submitted ? '#10B981' : 'white',
                    fontSize: '0.875rem', fontWeight: '600', cursor: submitting || submitted ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    transition: 'all 0.2s ease', boxShadow: submitted ? 'none' : '0 4px 14px rgba(59,130,246,0.25)',
                    opacity: submitting ? 0.7 : 1,
                  }}
                  onMouseEnter={e => { if (!submitting && !submitted) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(59,130,246,0.4)'; }}
                  onMouseLeave={e => { if (!submitted) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 14px rgba(59,130,246,0.25)'; }}
                >
                  {submitted ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                      Saved! Redirecting…
                    </>
                  ) : submitting ? 'Saving…' : 'Save Decision'}
                </button>
              </div>
            </section>
          </div>

        </div>
      </div>
    </div>
  );
}
