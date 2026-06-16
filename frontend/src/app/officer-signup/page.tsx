'use client';

import React, { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

export default function OfficerSignupPage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-white/50 animate-pulse">Loading...</p>
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to register as officer');
      }

      setMessage('Successfully registered as Loan Officer. Redirecting to admin dashboard...');
      setTimeout(() => {
        router.push('/admin');
      }, 2000);
      
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-xl">
        <h1 className="mb-4 text-2xl font-bold text-white">Loan Officer Portal</h1>
        <p className="mb-8 text-sm text-white/60">
          Register your account as a Loan Officer to access the Admin Dashboard and review pending KYC applications.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-4 rounded-lg bg-green-500/10 p-3 text-sm text-green-400 border border-green-500/20">
            {message}
          </div>
        )}

        <button
          onClick={handleRegister}
          disabled={loading || !!message}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Registering...' : 'Register as Loan Officer'}
        </button>
      </div>
    </div>
  );
}
