'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import api from '@/lib/api';

interface MyApplication {
  id: string;
  referenceNumber: string;
  loanType: string;
  loanAmount: number | null;
  tenure: number | null;
  purpose: string | null;
  status: string;
  submittedAt: string;
  decisionAt: string | null;
  documents: string[];
}

// ─── Status presentation ──────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; color: string; bg: string; border: string; message: string }> = {
  submitted:      { label: 'Submitted',       color: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)', message: 'Received — waiting for a loan officer.' },
  under_review:   { label: 'Under Review',    color: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)', message: 'A loan officer is reviewing your application.' },
  docs_requested: { label: 'Docs Requested',  color: '#F97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.25)', message: 'The officer needs more documents from you.' },
  conditional:    { label: 'Conditional',     color: '#3B82F6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.25)', message: 'Approved with conditions — we will contact you.' },
  approved:       { label: 'Approved',        color: '#10B981', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.25)', message: 'Congratulations — your loan is approved.' },
  rejected:       { label: 'Not Approved',    color: '#EF4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.25)',  message: 'Unfortunately this application was not approved.' },
};
const FALLBACK_STATUS = { label: 'Unknown', color: '#94A3B8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.20)', message: '' };

const PENDING = ['submitted', 'under_review'];

// Submitted → In Review → Decision; returns how many steps are complete
function progressStep(status: string) {
  if (status === 'submitted') return 1;
  if (status === 'under_review' || status === 'docs_requested') return 2;
  return 3;
}

const formatINR = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const DOC_LABEL: Record<string, string> = { pan: 'PAN', aadhaar: 'Aadhaar' };

// ─── Card ─────────────────────────────────────────────────────────────────────

function ApplicationCard({ app }: { app: MyApplication }) {
  const s = STATUS[app.status] ?? { ...FALLBACK_STATUS, label: app.status };
  const step = progressStep(app.status);
  const isPending = PENDING.includes(app.status);

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left', padding: '1.5rem', minWidth: 0 }}>
      {/* Header: ref + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            {app.loanType} loan
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-accent-blue)', marginTop: '2px' }}>
            {app.referenceNumber}
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 10px', borderRadius: '6px',
          background: s.bg, color: s.color, border: `1px solid ${s.border}`,
          fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          <span className={isPending ? 'status-dot-pulse' : ''} style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.color }} />
          {s.label}
        </span>
      </div>

      {/* Key figures */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Amount',    value: app.loanAmount ? formatINR(app.loanAmount) : '—' },
          { label: 'Tenure',    value: app.tenure ? `${app.tenure} mo` : '—' },
          { label: 'Submitted', value: formatDate(app.submittedAt) },
        ].map(item => (
          <div key={item.label} style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>{item.label}</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Progress tracker */}
      <div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              flex: 1, height: '4px', borderRadius: '2px',
              background: i <= step ? (i === 3 ? s.color : 'var(--color-accent-blue)') : 'var(--color-border)',
            }} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', fontSize: '0.65rem', color: 'var(--color-text-secondary)', marginTop: '6px', textAlign: 'center' }}>
          <span>Submitted</span><span>In Review</span><span>Decision</span>
        </div>
      </div>

      {/* Footer: status message + documents */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{s.message}</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          {['pan', 'aadhaar'].map(type => {
            const has = app.documents.includes(type);
            return (
              <span key={type} title={has ? 'Uploaded' : 'Not uploaded'} style={{
                fontSize: '0.65rem', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
                color: has ? 'var(--color-success)' : 'var(--color-text-secondary)',
                background: has ? 'rgba(16,185,129,0.10)' : 'transparent',
                border: `1px ${has ? 'solid rgba(16,185,129,0.3)' : 'dashed var(--color-border)'}`,
              }}>
                {has ? '✓' : '—'} {DOC_LABEL[type]}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export default function MyApplications() {
  const { getToken } = useAuth();
  const [apps, setApps] = useState<MyApplication[] | null>(null); // null = loading
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await api.get('/applications/mine', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setApps(res.data?.applications ?? []);
      } catch {
        if (!cancelled) { setError(true); setApps([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  return (
    <section style={{ width: '100%', maxWidth: '1116px', margin: '0 auto', padding: '0 16px', zIndex: 10, position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.75rem', paddingBottom: '1rem', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ textAlign: 'left' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Your Applications</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Track the status of every loan you have applied for.</p>
        </div>
        {apps && apps.length > 0 && (
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
            {apps.length} application{apps.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {apps === null ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '1rem' }}>
          {[0, 1].map(i => <div key={i} className="skeleton" style={{ height: '200px', borderRadius: '16px' }} />)}
        </div>
      ) : error ? (
        <div className="glass-card" style={{ textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
          Could not load your applications right now. Please refresh to try again.
        </div>
      ) : apps.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '2rem 1rem' }}>
          <div style={{ fontSize: '2rem' }}>📄</div>
          <p style={{ fontWeight: 600 }}>No applications yet</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Start a 5-minute video interview with Aria to apply.</p>
          <Link href="/onboard/language" className="btn-primary" style={{ marginTop: '0.5rem' }}>Start Application →</Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: '1.5rem' }}>
          {apps.map(app => <ApplicationCard key={app.id} app={app} />)}
        </div>
      )}
    </section>
  );
}
