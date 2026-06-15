'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';

export default function LanguagePicker() {
  const router = useRouter();
  const { language, setLanguage } = useAppStore();

  const handleContinue = () => {
    if (language) {
      router.push('/onboard/setup');
    }
  };

  return (
    <div className="flex-col flex-center animate-fade-in-up">
      <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }} className="text-gradient">
        Choose Your Language
      </h2>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: '3rem' }}>
        Select the language you are most comfortable speaking. Our AI assistant will interview you in this language.
      </p>

      <div style={{ display: 'flex', gap: '2rem', marginBottom: '3rem' }}>
        {/* English Option */}
        <div 
          className={`glass-card lang-card ${language === 'en' ? 'selected' : ''}`}
          onClick={() => setLanguage('en')}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🇬🇧</div>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>English</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>I want to proceed in English</p>
        </div>

        {/* Hindi Option */}
        <div 
          className={`glass-card lang-card ${language === 'hi' ? 'selected' : ''}`}
          onClick={() => setLanguage('hi')}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🇮🇳</div>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>हिंदी (Hindi)</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>मैं हिंदी में आगे बढ़ना चाहता हूँ</p>
        </div>
      </div>

      <button 
        className="btn-primary" 
        style={{ padding: '1rem 3rem', fontSize: '1.125rem', opacity: language ? 1 : 0.5, cursor: language ? 'pointer' : 'not-allowed' }}
        onClick={handleContinue}
        disabled={!language}
      >
        Continue ➔
      </button>

      <style jsx>{`
        .lang-card {
          width: 250px;
          text-align: center;
          cursor: pointer;
          transition: all 0.3s ease;
          border: 2px solid var(--color-border);
        }
        .lang-card:hover {
          border-color: rgba(59, 130, 246, 0.5);
          transform: translateY(-5px);
        }
        .lang-card.selected {
          border-color: var(--color-accent-blue);
          background: rgba(59, 130, 246, 0.1);
          box-shadow: 0 8px 32px rgba(59, 130, 246, 0.2);
        }
      `}</style>
    </div>
  );
}
