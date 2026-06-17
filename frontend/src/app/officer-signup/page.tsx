'use client';

import React, { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const STEPS = [
  { n: '1', title: 'Authenticate', desc: 'Sign in with your work account' },
  { n: '2', title: 'Register', desc: 'One-click officer registration' },
  { n: '3', title: 'Access Portal', desc: 'Review KYC applications' },
];

export default function OfficerSignupPage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!isLoaded) {
    return (
      <div style={{ minHeight: '100vh', background: '#080B14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid #3B82F6', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isSignedIn) {
    router.push('/sign-in?redirect_url=/officer-signup');
    return null;
  }

  const handleRegister = async () => {
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const token = await getToken();
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
      const res = await fetch(`${API_URL}/auth/register-officer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to register as officer');
      }
      setMessage('Registration successful! Redirecting to your dashboard…');
      setTimeout(() => router.push('/admin'), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#080B14',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-family)',
      position: 'relative', overflow: 'hidden',
      padding: '2rem 1rem',
    }}>
      {/* Ambient glows */}
      <div style={{ position: 'fixed', top: '-20%', right: '-10%', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(59,130,246,0.14) 0%, transparent 65%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '-20%', left: '-15%', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 65%)', pointerEvents: 'none', zIndex: 0 }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '460px', animation: 'fadeUp 0.5s ease-out' }}>

        {/* Brand mark */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2.5rem' }}>
          <div style={{
            width: '52px', height: '52px', borderRadius: '14px',
            background: 'linear-gradient(135deg, #2563EB, #8B5CF6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 32px rgba(59,130,246,0.35)',
            marginBottom: '0.875rem',
          }}>
            <span style={{ color: 'white', fontSize: '1.375rem', fontWeight: '800', letterSpacing: '-1px' }}>A</span>
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: '700', color: '#F1F5F9', letterSpacing: '-0.3px' }}>Aria</span>
          <span style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '3px' }}>Loan Officer Portal</span>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px',
          padding: '2rem',
          boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
        }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#F1F5F9', textAlign: 'center', marginBottom: '0.5rem', letterSpacing: '-0.3px' }}>
            Register as Loan Officer
          </h1>
          <p style={{ fontSize: '0.8125rem', color: '#64748B', textAlign: 'center', lineHeight: 1.6, marginBottom: '1.75rem' }}>
            Activate your officer account to access the admin dashboard and review pending KYC applications.
          </p>

          {/* Step guide */}
          <div style={{ display: 'flex', gap: '0', marginBottom: '1.75rem', position: 'relative' }}>
            {/* Connector line */}
            <div style={{
              position: 'absolute', top: '18px', left: 'calc(16.66% + 16px)', right: 'calc(16.66% + 16px)',
              height: '1px', background: 'linear-gradient(90deg, rgba(59,130,246,0.4), rgba(139,92,246,0.4))',
              zIndex: 0
            }} />
            {STEPS.map((s, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', position: 'relative', zIndex: 1 }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: message
                    ? 'linear-gradient(135deg, #059669, #10B981)'
                    : i === 1
                      ? 'linear-gradient(135deg, #2563EB, #8B5CF6)'
                      : 'rgba(255,255,255,0.05)',
                  border: i === 1 && !message ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: i === 1 && !message ? '0 0 16px rgba(59,130,246,0.25)' : 'none',
                  transition: 'all 0.3s ease',
                }}>
                  {message ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <span style={{ fontSize: '0.75rem', fontWeight: '700', color: i === 1 ? 'white' : '#64748B' }}>{s.n}</span>
                  )}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: '600', color: i === 1 && !message ? '#F1F5F9' : '#64748B', marginBottom: '2px' }}>{s.title}</div>
                  <div style={{ fontSize: '0.625rem', color: '#475569', lineHeight: 1.4 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Error state */}
          {error && (
            <div style={{
              marginBottom: '1rem', padding: '10px 14px', borderRadius: '10px',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              color: '#EF4444', fontSize: '0.8125rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start'
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          {/* Success state */}
          {message && (
            <div style={{
              marginBottom: '1rem', padding: '10px 14px', borderRadius: '10px',
              background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
              color: '#10B981', fontSize: '0.8125rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start'
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              {message}
            </div>
          )}

          {/* CTA Button */}
          <button
            onClick={handleRegister}
            disabled={loading || !!message}
            style={{
              width: '100%', padding: '12px',
              borderRadius: '11px', border: 'none',
              background: message
                ? 'rgba(16,185,129,0.12)'
                : 'linear-gradient(135deg, #2563EB 0%, #3B82F6 50%, #6366F1 100%)',
              color: message ? '#10B981' : 'white',
              fontSize: '0.9375rem', fontWeight: '700', cursor: loading || !!message ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              boxShadow: message ? 'none' : '0 6px 24px rgba(59,130,246,0.30)',
              transition: 'all 0.25s ease', opacity: loading ? 0.75 : 1,
              letterSpacing: '-0.2px',
            }}
            onMouseEnter={e => { if (!loading && !message) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 28px rgba(59,130,246,0.45)'; }}
            onMouseLeave={e => { if (!message) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 24px rgba(59,130,246,0.30)'; }}
          >
            {loading ? (
              <>
                <div style={{ width: '15px', height: '15px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', animation: 'spin 0.7s linear infinite' }} />
                Registering…
              </>
            ) : message ? (
              'Redirecting to Dashboard →'
            ) : (
              'Register as Loan Officer →'
            )}
          </button>

          <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.75rem', color: '#475569' }}>
            Already registered?{' '}
            <Link href="/admin" style={{ color: 'var(--color-accent-blue)', fontWeight: '600', textDecoration: 'none' }}>
              Go to Dashboard →
            </Link>
          </p>
        </div>

        {/* Footer hint */}
        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.7rem', color: '#334155' }}>
          Secured by Clerk · KYC Video Platform
        </p>
      </div>

      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin   { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
