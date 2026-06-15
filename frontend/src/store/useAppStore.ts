import { create } from 'zustand';

interface AppState {
  language: 'en' | 'hi' | null;
  sessionId: string | null;
  setLanguage: (lang: 'en' | 'hi') => void;
  setSessionId: (id: string) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  language: null,
  sessionId: null,
  setLanguage: (lang) => set({ language: lang }),
  setSessionId: (id) => set({ sessionId: id }),
  reset: () => set({ language: null, sessionId: null }),
}));
