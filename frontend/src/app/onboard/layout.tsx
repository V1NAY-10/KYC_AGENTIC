import React from 'react';
import ProgressStepper from '@/components/onboarding/ProgressStepper';
import Link from 'next/link';

export default function OnboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="onboard-wrapper" style={{ position: 'relative' }}>
      
      {/* Home Button (Visible across all onboarding steps) */}
      <div style={{ position: 'absolute', top: '1.5rem', left: '1.5rem', zIndex: 100 }}>
        <Link href="/" className="btn-secondary" style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '8px 16px', borderRadius: '8px',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.8)', fontSize: '0.875rem', fontWeight: '600',
          textDecoration: 'none', transition: 'all 0.2s', backdropFilter: 'blur(10px)'
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          Return Home
        </Link>
      </div>

      <div className="container" style={{ paddingTop: '2rem' }}>
        <ProgressStepper />
        <div className="onboard-content" style={{ marginTop: '3rem' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
