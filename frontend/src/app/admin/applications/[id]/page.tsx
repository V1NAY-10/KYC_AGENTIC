'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';

/* ─── Types ─────────────────────────────────────────────────────────────────── */
interface KYCField {
  key: string; label: string;
  finalValue: string; aiExtractedValue: string;
  confidence: number; isEdited: boolean; isFlagged: boolean;
}
interface Document { docType: string; cloudUrl: string; fileName: string; verified: boolean; verificationNote: string; }
interface FraudSignal { type: string; severity: string; description: string; }
interface LoanDecision {
  decision: string; score: number; reasons: string[]; conditions: string[];
  llmAssessment?: { strengths: string[]; risks: string[]; summary: string };
}
interface InterviewSummary {
  overallTone: string; totalTurns: number; durationSeconds: number;
  highConfidenceFields: string[]; lowConfidenceFields: string[];
  keyObservations: string[]; riskNotes: string[]; recommendedAction: string;
}
interface AppDetail {
  application: { _id: string; referenceNumber: string; status: string; loanType: string; loanAmount: number; tenure: number; purpose: string; createdAt: string; officerNote: string; officerDecision: string; };
  applicant:   { name: string; email: string; };
  session:     { durationSeconds: number; turnCount: number; traceCount: number; startTime: string; endTime: string; };
  kycFields:   KYCField[];
  documents:   Document[];
  geoRisk:     { ipAddress: string; city: string; country: string; isp: string; isVPN: boolean; isProxy: boolean; isTor: boolean; riskLevel: string; };
  fraudIntelligence: { score: number; riskLevel: string; signals: FraudSignal[]; };
  interviewSummary:  InterviewSummary | null;
  loanDecision:      LoanDecision | null;
}

/* ─── Shared UI ─────────────────────────────────────────────────────────────── */
function Panel({ title, icon, children, accent }: { title: string; icon: string; children: React.ReactNode; accent?: string }) {
  return (
    <section style={{
      borderRadius: '14px', overflow: 'hidden',
      border: `1px solid ${accent ? `${accent}25` : 'rgba(255,255,255,0.08)'}`,
      background: accent ? `${accent}06` : 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ padding: '0.75rem 1.25rem', borderBottom: `1px solid ${accent ? `${accent}15` : 'rgba(255,255,255,0.06)'}`, display: 'flex', alignItems: 'center', gap: '0.5rem', background: accent ? `${accent}08` : 'rgba(255,255,255,0.02)' }}>
        <span>{icon}</span>
        <h2 style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--color-text-primary)', margin: 0 }}>{title}</h2>
      </div>
      <div style={{ padding: '1.25rem' }}>{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '500', minWidth: '110px' }}>{label}</span>
      <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-primary)', textAlign: 'right', fontWeight: '500' }}>{value || '—'}</span>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const c = level === 'high' ? '#ef4444' : level === 'medium' ? '#f59e0b' : '#10b981';
  return <span style={{ padding: '3px 8px', borderRadius: '6px', background: `${c}18`, border: `1px solid ${c}40`, color: c, fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase' }}>{level} Risk</span>;
}

function ScoreGauge({ score, invert = false }: { score: number; invert?: boolean }) {
  const r = 38, circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = invert
    ? (score >= 60 ? '#ef4444' : score >= 30 ? '#f59e0b' : '#10b981')
    : (score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444');
  return (
    <div style={{ position: 'relative', width: '88px', height: '88px', flexShrink: 0 }}>
      <svg width="88" height="88" viewBox="0 0 90 90" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="45" cy="45" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
        <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ filter: `drop-shadow(0 0 5px ${color}80)` }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '1.375rem', fontWeight: '800', color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: '0.5rem', color: '#64748b', fontWeight: '600' }}>/ 100</span>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────────── */
export default function ApplicationDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const [data, setData] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState('');
  const [officerNote, setOfficerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { router.push('/sign-in?redirect_url=/admin'); return; }
    (async () => {
      try {
        const token = await getToken();
        const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
        const res = await fetch(`${BASE}/admin/applications/${id}/detail`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to load application');
        const json: AppDetail = await res.json();
        setData(json);
        const s = json.application.status;
        setDecision(['approved', 'conditional', 'rejected'].includes(s) ? s : '');
        setOfficerNote(json.application.officerNote || '');
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Error loading report');
      } finally { setLoading(false); }
    })();
  }, [id, isLoaded, isSignedIn, getToken, router]);

  const saveDecision = async () => {
    if (!decision) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
      const res = await fetch(`${BASE}/admin/applications/${id}/decision`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: decision, officerDecision: decision, officerNote })
      });
      if (!res.ok) throw new Error('Failed to save');
      setSubmitted(true);
      setTimeout(() => router.push('/admin'), 1500);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error');
      setSubmitting(false);
    }
  };

  if (loading || !isLoaded) return <div style={{ padding: '2rem', color: '#64748b' }}>Loading intelligence report…</div>;
  if (error || !data) return <div style={{ padding: '2rem', color: '#ef4444' }}>Error: {error || 'Not found'}</div>;

  const { application, applicant, session, kycFields, documents, geoRisk, fraudIntelligence, interviewSummary, loanDecision } = data;
  const fmt = (n: number) => n ? `₹${n.toLocaleString('en-IN')}` : '—';

  return (
    <div style={{ paddingBottom: '5rem' }}>

      {/* Header */}
      <div style={{ marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Link href="/admin" style={{ color: 'var(--color-accent-blue)', fontSize: '0.8rem', textDecoration: 'none' }}>← Back</Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--color-text-primary)', marginTop: '0.5rem' }}>
          Application <span style={{ fontFamily: 'monospace', color: 'var(--color-accent-blue)' }}>#{application.referenceNumber}</span>
        </h1>
        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
          {applicant.name} · {applicant.email} · {new Date(application.createdAt).toLocaleString()}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: '1.25rem', alignItems: 'start' }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Applicant & Loan */}
          <Panel title="Applicant & Loan Details" icon="👤">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
              <div>
                <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Profile</div>
                <Row label="Name" value={<strong style={{ color: 'var(--color-text-primary)' }}>{applicant.name}</strong>} />
                <Row label="Email" value={applicant.email} />
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Loan Request</div>
                <Row label="Type" value={<span style={{ textTransform: 'capitalize' }}>{application.loanType}</span>} />
                <Row label="Amount" value={<strong style={{ color: '#10b981' }}>{fmt(application.loanAmount)}</strong>} />
                <Row label="Tenure" value={application.tenure ? `${application.tenure} months` : '—'} />
                <Row label="Purpose" value={application.purpose} />
              </div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ padding: '4px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', fontSize: '0.75rem', color: '#64748b' }}>
                🎙️ {session.turnCount} turns · {Math.floor(session.durationSeconds / 60)}m {session.durationSeconds % 60}s
              </div>
              <div style={{ padding: '4px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', fontSize: '0.75rem', color: '#64748b' }}>
                🔍 {session.traceCount} agent traces
              </div>
            </div>
          </Panel>

          {/* All KYC Fields */}
          <Panel title="Extracted KYC Data" icon="📋">
            {kycFields.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No KYC fields extracted.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {kycFields.map((f) => {
                  const val = f.finalValue || f.aiExtractedValue;
                  const conf = Math.round((f.confidence || 0) * 100);
                  return (
                    <div key={f.key} style={{ padding: '0.625rem', borderRadius: '8px', background: f.isFlagged ? 'rgba(245,158,11,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${f.isFlagged ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
                      <div style={{ fontSize: '0.625rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>
                        {f.label || f.key}
                        {f.isEdited && <span style={{ marginLeft: '4px', color: '#3b82f6' }}>✏</span>}
                        {f.isFlagged && <span style={{ marginLeft: '4px', color: '#f59e0b' }}>⚠</span>}
                      </div>
                      <div style={{ fontSize: '0.8125rem', fontWeight: '600', color: val ? 'var(--color-text-primary)' : '#64748b', fontStyle: val ? 'normal' : 'italic' }}>
                        {val || 'Not provided'}
                      </div>
                      <div style={{ marginTop: '3px', height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}>
                        <div style={{ height: '100%', width: `${conf}%`, borderRadius: '2px', background: conf >= 80 ? '#10b981' : conf >= 60 ? '#f59e0b' : '#ef4444' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Documents */}
          <Panel title="Documents & Verification" icon="📄">
            {documents.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No documents uploaded.</p>
            ) : (
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {documents.map((doc, i) => (
                  <div key={i} style={{ flex: '1 1 200px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '1rem', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: '700', textTransform: 'uppercase', fontSize: '0.875rem' }}>{doc.docType}</span>
                      <a href={doc.cloudUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--color-accent-blue)', textDecoration: 'none' }}>View →</a>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</div>
                    <div style={{ padding: '5px 8px', borderRadius: '6px', background: doc.verified ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)', border: `1px solid ${doc.verified ? '#10b98130' : '#f59e0b30'}`, fontSize: '0.7rem', color: doc.verified ? '#10b981' : '#f59e0b' }}>
                      {doc.verified ? '✅' : '⚠️'} {doc.verificationNote}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* AI Loan Assessment */}
          {loanDecision && (
            <Panel title="AI Loan Assessment" icon="🏦" accent="#3b82f6">
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <ScoreGauge score={loanDecision.score} />
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: '0.5rem' }}>
                    {(() => {
                      const c = loanDecision.decision === 'approved' ? '#10b981' : loanDecision.decision === 'rejected' ? '#ef4444' : '#f59e0b';
                      return <span style={{ padding: '4px 10px', borderRadius: '6px', background: `${c}18`, border: `1px solid ${c}40`, color: c, fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>
                        AI: {loanDecision.decision?.replace('_', ' ')}
                      </span>;
                    })()}
                  </div>
                  {loanDecision.llmAssessment?.summary && (
                    <p style={{ fontSize: '0.8125rem', color: '#94a3b8', fontStyle: 'italic', lineHeight: 1.6 }}>
                      &ldquo;{loanDecision.llmAssessment.summary}&rdquo;
                    </p>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: '0.65rem', color: '#10b981', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.5rem' }}>✓ Strengths</div>
                  {(loanDecision.llmAssessment?.strengths || []).map((s, i) => (
                    <div key={i} style={{ fontSize: '0.775rem', color: '#94a3b8', marginBottom: '4px', display: 'flex', gap: '6px' }}>
                      <span style={{ color: '#10b981', flexShrink: 0 }}>•</span>{s}
                    </div>
                  ))}
                  {(!loanDecision.llmAssessment?.strengths?.length) && <div style={{ fontSize: '0.775rem', color: '#64748b', fontStyle: 'italic' }}>None noted</div>}
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.5rem' }}>✕ Risks</div>
                  {(loanDecision.llmAssessment?.risks || loanDecision.reasons || []).map((r, i) => (
                    <div key={i} style={{ fontSize: '0.775rem', color: '#94a3b8', marginBottom: '4px', display: 'flex', gap: '6px' }}>
                      <span style={{ color: '#ef4444', flexShrink: 0 }}>•</span>{r}
                    </div>
                  ))}
                </div>
              </div>
              {loanDecision.conditions?.length > 0 && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '8px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)' }}>
                  <div style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Conditions</div>
                  {loanDecision.conditions.map((c, i) => (
                    <div key={i} style={{ fontSize: '0.775rem', color: '#94a3b8', marginBottom: '4px' }}>· {c}</div>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {/* Interview Summary */}
          <Panel title="AI Interview Summary" icon="🤖" accent="#8b5cf6">
            {interviewSummary ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', paddingBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  {[
                    ['Overall Tone', interviewSummary.overallTone],
                    ['Duration', `${Math.floor(interviewSummary.durationSeconds / 60)}m ${interviewSummary.durationSeconds % 60}s`],
                    ['Turns', String(interviewSummary.totalTurns || session.turnCount)],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '3px' }}>{label}</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--color-text-primary)', textTransform: 'capitalize' }}>{val}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', color: '#8b5cf6', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Key Observations</div>
                  {interviewSummary.keyObservations?.map((obs, i) => (
                    <div key={i} style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '5px', display: 'flex', gap: '8px' }}>
                      <span style={{ color: '#8b5cf6', flexShrink: 0 }}>→</span>{obs}
                    </div>
                  ))}
                  {!interviewSummary.keyObservations?.length && <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No observations yet (interview may still be processing)</div>}
                </div>
                {interviewSummary.riskNotes?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.65rem', color: '#f59e0b', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Risk Notes</div>
                    {interviewSummary.riskNotes.map((n, i) => (
                      <div key={i} style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '5px', display: 'flex', gap: '8px' }}>
                        <span style={{ color: '#f59e0b', flexShrink: 0 }}>⚠</span>{n}
                      </div>
                    ))}
                  </div>
                )}
                {interviewSummary.recommendedAction && (
                  <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.2)', fontSize: '0.8125rem', color: '#c4b5fd', fontWeight: '500' }}>
                    💡 {interviewSummary.recommendedAction}
                  </div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>Interview summary is being generated — check back shortly.</p>
            )}
          </Panel>

        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Fraud Intelligence */}
          <Panel title="Fraud Intelligence" icon="🛡️" accent={fraudIntelligence.score > 30 ? '#ef4444' : undefined}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
              <ScoreGauge score={fraudIntelligence.score} invert />
              <div>
                <RiskBadge level={fraudIntelligence.riskLevel} />
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>{fraudIntelligence.signals.length} signal(s) detected</div>
              </div>
            </div>
            {fraudIntelligence.signals.map((sig, i) => (
              <div key={i} style={{ marginBottom: '6px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.12)', fontSize: '0.75rem', color: '#94a3b8' }}>
                <span style={{ color: sig.severity === 'high' ? '#ef4444' : sig.severity === 'medium' ? '#f59e0b' : '#10b981', fontWeight: '700', marginRight: '6px' }}>[{sig.severity.toUpperCase()}]</span>
                {sig.description}
              </div>
            ))}
            {fraudIntelligence.signals.length === 0 && (
              <div style={{ fontSize: '0.8rem', color: '#10b981', display: 'flex', gap: '6px', alignItems: 'center' }}>✅ No fraud signals</div>
            )}
          </Panel>

          {/* IP & Geo */}
          <Panel title="IP & Geo Risk" icon="📍" accent={geoRisk.isVPN || geoRisk.isProxy ? '#f59e0b' : undefined}>
            <div style={{ marginBottom: '0.75rem' }}><RiskBadge level={geoRisk.riskLevel} /></div>
            <Row label="IP Address" value={<code style={{ fontSize: '0.75rem' }}>{geoRisk.ipAddress}</code>} />
            <Row label="Location" value={`${geoRisk.city}, ${geoRisk.country}`} />
            <Row label="ISP" value={geoRisk.isp} />
            <div style={{ display: 'flex', gap: '6px', marginTop: '0.75rem' }}>
              {['VPN', 'Proxy', 'Tor'].map((label, i) => {
                const active = [geoRisk.isVPN, geoRisk.isProxy, geoRisk.isTor][i];
                return <span key={label} style={{ fontSize: '0.65rem', padding: '2px 7px', borderRadius: '4px', background: active ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.05)', color: active ? '#ef4444' : '#64748b', fontWeight: '700' }}>{label}</span>;
              })}
            </div>
          </Panel>

          {/* Officer Decision — sticky */}
          <div style={{ position: 'sticky', top: '80px' }}>
            <section style={{ padding: '1.25rem', borderRadius: '14px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: '#dbeafe', marginBottom: '1rem' }}>⚖️ Officer Decision</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '5px' }}>Final Status</label>
                  <select value={decision} onChange={e => setDecision(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', background: 'rgba(8,11,20,0.9)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '0.875rem' }}>
                    <option value="" disabled>Select decision…</option>
                    <option value="approved">✓ Approve</option>
                    <option value="conditional">◎ Conditional Approval</option>
                    <option value="rejected">✕ Reject</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '5px' }}>Internal Note</label>
                  <textarea value={officerNote} onChange={e => setOfficerNote(e.target.value)} placeholder="Add justification or conditions…" rows={3} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', background: 'rgba(8,11,20,0.9)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '0.875rem', resize: 'none' }} />
                </div>
                <button
                  onClick={saveDecision}
                  disabled={submitting || submitted || !decision}
                  style={{
                    width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                    background: submitted ? '#10b981' : decision ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'rgba(255,255,255,0.08)',
                    color: 'white', fontWeight: '600', cursor: submitting || submitted || !decision ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem', transition: 'all 0.2s',
                  }}
                >
                  {submitted ? '✓ Saved! Redirecting…' : submitting ? 'Saving…' : 'Save Decision'}
                </button>
              </div>
            </section>
          </div>

        </div>
      </div>
    </div>
  );
}
