import Link from 'next/link';
import { SignedIn, SignedOut, UserButton, SignOutButton } from '@clerk/nextjs';

export default function LandingPage() {
  return (
    <div className="flex-col" style={{ position: 'relative', overflow: 'hidden' }}>
      
      {/* Background Glows */}
      <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)', zIndex: 0 }} />
      <div style={{ position: 'absolute', bottom: '-20%', left: '-10%', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)', zIndex: 0 }} />

      {/* Navbar */}
      <nav className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', zIndex: 10 }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--color-accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'white', fontSize: '1rem' }}>A</span>
          </div>
          Aria
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link href="/admin" style={{ color: 'var(--color-accent-blue)', fontSize: '0.9rem', fontWeight: 600, paddingRight: '1rem', borderRight: '1px solid var(--color-border)' }}>
            Officer Portal
          </Link>
          <SignedOut>
            <Link href="/sign-in" style={{ color: 'var(--color-text-secondary)', padding: '0.5rem 1rem', fontWeight: 500 }}>Log in</Link>
            <Link href="/sign-up" className="btn-primary">Get Started</Link>
          </SignedOut>
          <SignedIn>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <SignOutButton>
                <button style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontWeight: 500, fontSize: '0.9rem', cursor: 'pointer' }}>
                  Log out
                </button>
              </SignOutButton>
              <UserButton afterSignOutUrl="/" />
            </div>
          </SignedIn>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="container flex-col flex-center animate-fade-in-up" style={{ textAlign: 'center', minHeight: '80vh', zIndex: 10 }}>
        <div style={{ padding: '0.5rem 1rem', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-accent-blue)', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 600, marginBottom: '1.5rem', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
          🚀 The Future of KYC is Here
        </div>
        
        <h1 style={{ fontSize: '4rem', marginBottom: '1.5rem', maxWidth: '800px' }}>
          Apply for a Loan in 5 Minutes — <span className="text-gradient">No Forms, Just Talk.</span>
        </h1>
        
        <p style={{ fontSize: '1.25rem', color: 'var(--color-text-secondary)', marginBottom: '3rem', maxWidth: '600px' }}>
          Our AI assistant interviews you in your preferred language, verifying your identity and affordability instantly via video call.
        </p>

        <Link href="/sign-up" className="btn-primary" style={{ fontSize: '1.25rem', padding: '1rem 2rem' }}>
          Start Application Process →
        </Link>

        {/* How it works simple row */}
        <div style={{ display: 'flex', gap: '2rem', marginTop: '5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { step: '1', title: 'Sign In', desc: 'Secure OTP / Email login' },
            { step: '2', title: 'Choose Language', desc: 'English, Hindi & more' },
            { step: '3', title: 'Video Call', desc: 'Talk to our AI Agent Aria' },
            { step: '4', title: 'Done', desc: 'Application auto-submits' }
          ].map(item => (
            <div key={item.step} className="glass-card" style={{ width: '220px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-accent-cyan)', fontWeight: 'bold' }}>
                {item.step}
              </div>
              <h3 style={{ fontSize: '1.1rem', marginTop: '0.5rem' }}>{item.title}</h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </main>

    </div>
  );
}
