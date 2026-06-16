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
      <div className="flex min-h-screen bg-[#09090b] items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-zinc-800 border-t-zinc-400 animate-spin" />
          <p className="text-zinc-400 text-sm font-medium">Authenticating...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] text-zinc-100 font-sans selection:bg-blue-500/30">

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 w-full border-b border-zinc-800/80 bg-[#09090b]/80 backdrop-blur-md">
        <div className="flex h-14 items-center px-6 gap-6">

          {/* Logo / Brand */}
          <Link href="/admin" className="flex items-center gap-2 mr-100">
            <div className="w-6 h-6 rounded bg-zinc-100 flex items-center justify-center">
              <span className="text-[#09090b] text-xs font-bold">A</span>
            </div>
            <span className="font-semibold text-sm tracking-tight text-zinc-100">Aria Admin</span>
          </Link>

          {/* Nav Links */}
          <nav className="flex items-center gap-8 text-sm font-medium">
            <Link
              href="/admin"
              className={`transition-colors ${pathname === '/admin' || pathname.startsWith('/admin/applications') ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Dashboard
            </Link>
            <Link
              href="/"
              className="text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Back to App
            </Link>
          </nav>

          {/* Right side (User) */}
          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-3 border-l border-zinc-800 pl-4">
              <div className="flex flex-col text-right">
                <span className="text-sm font-medium leading-none text-zinc-200">{officerName}</span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider mt-1">Loan Officer</span>
              </div>
              <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700">
                <span className="text-xs font-medium text-zinc-300">{officerName.charAt(0).toUpperCase()}</span>
              </div>
              <button
                onClick={() => signOut(() => router.push('/'))}
                className="ml-2 text-zinc-400 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-zinc-800/50"
                title="Log out"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-6 md:p-8 pt-8">
        {children}
      </main>

    </div>
  );
}
