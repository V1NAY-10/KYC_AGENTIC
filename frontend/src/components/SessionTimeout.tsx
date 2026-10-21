'use client';

import { useEffect, useRef } from 'react';
import { useAuth, useClerk } from '@clerk/nextjs';
import { useRouter, usePathname } from 'next/navigation';

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes of inactivity

// The video interview is voice-only — no mouse/keyboard events fire while the
// applicant talks, so the inactivity logout must not run there.
const VOICE_ONLY_PATHS = ['/onboard/call'];

export default function SessionTimeout({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();
  const pathname = usePathname();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const onVoicePage = VOICE_ONLY_PATHS.some(p => pathname?.startsWith(p));
    if (!isSignedIn || onVoicePage) {
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
  }, [isSignedIn, signOut, router, pathname]);

  return <>{children}</>;
}
