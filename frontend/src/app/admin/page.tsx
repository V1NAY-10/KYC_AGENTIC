'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

interface Application {
  _id: string;
  referenceNumber: string;
  status: string;
  loanType: string;
  loanAmount: number | null;
  createdAt: string;
  userId: {
    _id: string;
    name: string;
    email: string;
  };
}

/* ─── Helpers ─────────────────────────────────────────────────── */
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const isPending = status === 'submitted' || status === 'under_review';
  const map: Record<string, { label: string; color: string; bg: string; border: string }> = {
    submitted:    { label: 'In Review', color: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)' },
    under_review: { label: 'In Review', color: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)' },
    approved:     { label: 'Approved',  color: '#10B981', bg: 'rgba(16,185,129,0.10)',  border: 'rgba(16,185,129,0.25)'  },
    rejected:     { label: 'Rejected',  color: '#EF4444', bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.25)'   },
    conditional:  { label: 'Conditional',color: '#3B82F6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.25)'  },
  };
  const s = map[status] ?? { label: status, color: '#94A3B8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.20)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 9px', borderRadius: '6px',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      fontSize: '0.75rem', fontWeight: '600', whiteSpace: 'nowrap'
    }}>
      <span className={isPending ? 'status-dot-pulse' : ''} style={{
        width: '6px', height: '6px', borderRadius: '50%', background: s.color, flexShrink: 0
      }} />
      {s.label}
    </span>
  );
}

function StatCard({
  label, value, icon, colorVar, glowClass, delay
}: {
  label: string; value: number; icon: React.ReactNode;
  colorVar: string; glowClass: string; delay: string;
}) {
  return (
    <div className={`admin-glass panel-in ${glowClass}`} style={{
      animationDelay: delay, opacity: 0,
      padding: '1.25rem 1.5rem',
      display: 'flex', alignItems: 'center', gap: '1rem',
      flex: '1', minWidth: '160px',
      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    }}
      onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
    >
      <div style={{
        width: '40px', height: '40px', borderRadius: '10px',
        background: `color-mix(in srgb, ${colorVar} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${colorVar} 25%, transparent)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, color: colorVar,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: '500', marginBottom: '3px' }}>{label}</div>
        <div style={{ fontSize: '1.625rem', fontWeight: '700', color: 'var(--color-text-primary)', lineHeight: 1 }}>{value}</div>
      </div>
    </div>
  );
}

/* ─── Skeleton ──────────────────────────────────────────────────── */
function TableSkeleton() {
  return (
    <div style={{ padding: '0.75rem' }}>
      {[1,2,3,4].map(i => (
        <div key={i} className="skeleton" style={{ height: '52px', marginBottom: '8px', borderRadius: '10px' }} />
      ))}
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────── */
export default function AdminDashboardPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { router.push('/sign-in?redirect_url=/admin'); return; }

    const fetchApplications = async () => {
      try {
        const token = await getToken();
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
        const res = await fetch(`${API_URL}/admin/applications`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          if (res.status === 403) { router.push('/officer-signup'); return; }
          throw new Error('Failed to fetch applications');
        }
        const data = await res.json();
        setApplications(data.applications || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };
    fetchApplications();
  }, [isLoaded, isSignedIn, getToken, router]);

  const total     = applications.length;
  const pending   = applications.filter(a => a.status === 'under_review' || a.status === 'submitted').length;
  const approved  = applications.filter(a => a.status === 'approved').length;
  const rejected  = applications.filter(a => a.status === 'rejected').length;

  const filtered = applications.filter(a => {
    if (filter === 'pending')  return a.status === 'under_review' || a.status === 'submitted';
    if (filter === 'approved') return a.status === 'approved';
    if (filter === 'rejected') return a.status === 'rejected';
    return true;
  });

  if (!isLoaded || loading) return (
    <div style={{ animationDelay: '0.05s' }}>
      {/* Header skeleton */}
      <div className="skeleton" style={{ height: '32px', width: '200px', marginBottom: '8px' }} />
      <div className="skeleton" style={{ height: '16px', width: '300px', marginBottom: '2rem' }} />
      {/* Stat cards skeleton */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: '80px', flex: '1', minWidth: '150px', borderRadius: '16px' }} />)}
      </div>
      {/* Table skeleton */}
      <div className="admin-glass" style={{ overflow: 'hidden' }}>
        <TableSkeleton />
      </div>
    </div>
  );

  if (error) return (
    <div style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#EF4444', fontSize: '0.875rem' }}>
      <strong>Error: </strong>{error}
    </div>
  );

  return (
    <div>
      {/* ── Page header ── */}
      <div className="panel-in" style={{ marginBottom: '2rem', opacity: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.625rem', fontWeight: '700', color: 'var(--color-text-primary)', letterSpacing: '-0.4px', marginBottom: '4px' }}>
              Applications
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
              Review and manage KYC applications from borrowers.
            </p>
          </div>
          <div style={{
            fontSize: '0.75rem', fontWeight: '500', color: 'var(--color-text-secondary)',
            padding: '6px 12px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)'
          }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <StatCard label="Total" value={total} glowClass="stat-glow-blue" colorVar="#3B82F6" delay="0.05s" icon={
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        }/>
        <StatCard label="Pending" value={pending} glowClass="stat-glow-amber" colorVar="#F59E0B" delay="0.10s" icon={
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        }/>
        <StatCard label="Approved" value={approved} glowClass="stat-glow-green" colorVar="#10B981" delay="0.15s" icon={
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        }/>
        <StatCard label="Rejected" value={rejected} glowClass="stat-glow-red" colorVar="#EF4444" delay="0.20s" icon={
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        }/>
      </div>

      {/* ── Table card ── */}
      <div className="admin-glass panel-in panel-in-4" style={{ overflow: 'hidden' }}>

        {/* Table header with filters */}
        <div style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '1rem', flexWrap: 'wrap',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--color-text-primary)' }}>All Applications</span>
            <span style={{
              fontSize: '0.7rem', fontWeight: '700', padding: '1px 7px', borderRadius: '20px',
              background: 'rgba(59,130,246,0.12)', color: 'var(--color-accent-blue)',
              border: '1px solid rgba(59,130,246,0.25)'
            }}>{filtered.length}</span>
          </div>
          {/* Filter pills */}
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '5px 12px', borderRadius: '7px', fontSize: '0.75rem', fontWeight: '500',
                cursor: 'pointer', border: '1px solid',
                background:   filter === f ? 'rgba(59,130,246,0.12)' : 'transparent',
                color:        filter === f ? 'var(--color-accent-blue)' : 'var(--color-text-secondary)',
                borderColor:  filter === f ? 'rgba(59,130,246,0.3)'    : 'rgba(255,255,255,0.07)',
                transition: 'all 0.15s ease', textTransform: 'capitalize'
              }}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Reference', 'Applicant', 'Loan Type', 'Amount', 'Submitted', 'Status', ''].map((h, i) => (
                  <th key={i} style={{
                    padding: '0.75rem 1rem', fontSize: '0.7rem', fontWeight: '600',
                    color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em',
                    textAlign: i === 6 ? 'right' : 'left'
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '4rem', textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{
                        width: '48px', height: '48px', borderRadius: '14px',
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--color-text-secondary)'
                      }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                        </svg>
                      </div>
                      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>No applications found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((app) => (
                  <tr key={app._id} className="admin-table-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--color-accent-blue)', fontWeight: '600' }}>
                        #{app.referenceNumber}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div>
                        <div style={{ fontWeight: '500', color: 'var(--color-text-primary)', marginBottom: '2px' }}>
                          {app.userId?.name || 'Unknown'}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
                          {app.userId?.email || 'N/A'}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: '600',
                        background: 'rgba(139,92,246,0.10)', color: '#A78BFA',
                        border: '1px solid rgba(139,92,246,0.20)', textTransform: 'capitalize'
                      }}>
                        {app.loanType}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontWeight: '600', color: 'var(--color-text-primary)' }}>
                      {app.loanAmount ? `$${app.loanAmount.toLocaleString()}` : <span style={{ color: 'var(--color-text-secondary)' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div>
                        <div style={{ color: 'var(--color-text-primary)', fontSize: '0.8rem' }}>
                          {new Date(app.createdAt).toLocaleDateString()}
                        </div>
                        <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.7rem' }}>
                          {timeAgo(app.createdAt)}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <StatusBadge status={app.status} />
                    </td>
                    <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                      <Link
                        href={`/admin/applications/${app._id}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                          padding: '5px 12px', borderRadius: '7px',
                          fontSize: '0.75rem', fontWeight: '600',
                          background: 'rgba(59,130,246,0.10)', color: 'var(--color-accent-blue)',
                          border: '1px solid rgba(59,130,246,0.25)',
                          textDecoration: 'none', transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(59,130,246,0.18)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(59,130,246,0.4)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(59,130,246,0.10)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(59,130,246,0.25)'; }}
                      >
                        Review
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m9 18 6-6-6-6"/>
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
