import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AppState {
  language: 'en' | 'hi' | null;
  sessionId: string | null;
  setLanguage: (lang: 'en' | 'hi') => void;
  setSessionId: (id: string) => void;
  reset: () => void;
}

// Persisted per-tab so a page refresh mid-interview resumes the same session
// instead of bouncing the applicant back to the setup step.
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      language: null,
      sessionId: null,
      setLanguage: (lang) => set({ language: lang }),
      setSessionId: (id) => set({ sessionId: id }),
      reset: () => set({ language: null, sessionId: null }),
    }),
    {
      name: 'kyc-app-state',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
