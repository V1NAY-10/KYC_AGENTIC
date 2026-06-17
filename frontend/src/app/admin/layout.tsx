'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, useClerk } from '@clerk/nextjs';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();

  const [authChecking, setAuthChecking] = useState(true);
  const [officerName, setOfficerName] = useState('Officer');

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.push('/sign-in?redirect_url=/admin');
      return;
    }

    const verifyRole = async () => {
      try {
        const token = await getToken();
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Not found');

        const data = await res.json();
        if (data.user?.role !== 'officer' && data.user?.role !== 'admin') {
          router.push('/officer-signup');
        } else {
          setOfficerName(data.user?.name || 'Officer');
          setAuthChecking(false);
        }
      } catch (err) {
        console.error('Auth verification failed', err);
        router.push('/');
      }
    };

    verifyRole();
  }, [isLoaded, isSignedIn, getToken, router]);

  if (authChecking) {
    return (
      <div className="admin-bg flex min-h-screen items-center justify-center" style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          {/* Branded logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'linear-gradient(135deg, var(--color-accent-blue), var(--color-accent-purple))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px rgba(59,130,246,0.35)'
            }}>
              <span style={{ color: 'white', fontSize: '1rem', fontWeight: '700' }}>A</span>
            </div>
            <span style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--color-text-primary)' }}>Aria</span>
          </div>
          {/* Spinner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '18px', height: '18px', borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.08)',
              borderTop: '2px solid var(--color-accent-blue)',
              animation: 'spin 0.8s linear infinite'
            }} />
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', fontWeight: '500' }}>
              Authenticating…
            </p>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const isOnDashboard = pathname === '/admin' || pathname.startsWith('/admin/applications');

  return (
    <div className="admin-bg" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-family)' }}>

      {/* Ambient glows are on .admin-bg pseudo-elements */}

      {/* ── Top Header ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(8, 11, 20, 0.80)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', height: '60px', padding: '0 1.75rem', gap: '2rem' }}>

          {/* Logo */}
          <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', textDecoration: 'none', marginRight: '1rem' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '9px',
              background: 'linear-gradient(135deg, var(--color-accent-blue), var(--color-accent-purple))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 16px rgba(59,130,246,0.30)',
              flexShrink: 0
            }}>
              <span style={{ color: 'white', fontSize: '0.875rem', fontWeight: '800', letterSpacing: '-0.5px' }}>A</span>
            </div>
            <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>
              Aria
            </span>
            <span style={{
              fontSize: '0.6rem', fontWeight: '700', letterSpacing: '0.1em',
              color: 'var(--color-accent-blue)', textTransform: 'uppercase',
              padding: '2px 6px', border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: '4px', background: 'rgba(59,130,246,0.08)'
            }}>
              Admin
            </span>
          </Link>

          {/* Nav Links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <NavLink href="/admin" active={isOnDashboard}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/>
                <rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>
              </svg>
              Dashboard
            </NavLink>
            <NavLink href="/" active={false}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              Back to App
            </NavLink>
          </nav>

          {/* Right — User */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              paddingLeft: '1rem', borderLeft: '1px solid rgba(255,255,255,0.07)'
            }}>
              {/* Name + Role */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--color-text-primary)', lineHeight: 1 }}>
                  {officerName}
                </span>
                <span style={{ fontSize: '0.6rem', color: 'var(--color-accent-blue)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '3px', fontWeight: '600' }}>
                  Loan Officer
                </span>
              </div>

              {/* Avatar */}
              <div style={{
                width: '34px', height: '34px', borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(139,92,246,0.25))',
                border: '1.5px solid rgba(59,130,246,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0
              }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: '700', color: 'var(--color-accent-blue)' }}>
                  {officerName.charAt(0).toUpperCase()}
                </span>
              </div>

              {/* Sign out */}
              <button
                onClick={() => signOut(() => router.push('/'))}
                title="Log out"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-secondary)', padding: '6px',
                  borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'color 0.15s, background 0.15s'
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#EF4444'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        {/* Gradient accent line */}
        <div className="admin-header-line" />
      </header>

      {/* ── Main Content ── */}
      <main style={{ flex: 1, width: '100%', maxWidth: '1280px', margin: '0 auto', padding: '2rem 1.75rem', position: 'relative', zIndex: 1 }}>
        {children}
      </main>

    </div>
  );
}

/* ── NavLink sub-component ── */
function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.375rem 0.75rem', borderRadius: '8px',
        fontSize: '0.8125rem', fontWeight: active ? '600' : '500',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
        border: active ? '1px solid rgba(255,255,255,0.07)' : '1px solid transparent',
        textDecoration: 'none',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </Link>
  );
}
