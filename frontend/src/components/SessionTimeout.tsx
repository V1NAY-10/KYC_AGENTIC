'use client';

import { useEffect, useRef } from 'react';
import { useAuth, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes of inactivity

export default function SessionTimeout({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    const resetTimer = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        // Log out user due to inactivity
        signOut({ redirectUrl: '/sign-in' });
        // We could also show an alert, but direct logout is requested
        alert('You have been logged out due to inactivity.');
      }, TIMEOUT_MS);
    };

    // Initialize
    resetTimer();

    // Listeners for user activity
    const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, resetTimer));

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [isSignedIn, signOut, router]);

  return <>{children}</>;
}
