'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';

interface KYCField {
  key: string;
  label: string;
  section: 'personal' | 'financial' | 'loan';
  aiExtractedValue: any;
  finalValue: any;
  confidence: number;
  isFlagged: boolean;
  isEdited: boolean;
}

interface LoanDecision {
  decision: 'approved' | 'conditional' | 'rejected' | 'manual_review';
  score: number;
  reasons: string[];
  conditions: string[];
  ruleFlags: Record<string, any>;
  llmAssessment: {
    strengths: string[];
    risks: string[];
    summary: string;
  } | null;
}

interface ReviewData {
  sessionId: string;
  extractedFields: KYCField[];
  loanDecision: LoanDecision;
}

const DECISION_CONFIG = {
  approved:      { label: 'Approved',       color: 'green',  icon: '✅', bg: 'bg-green-500/10',  border: 'border-green-500/30',  text: 'text-green-400' },
  conditional:   { label: 'Conditional',    color: 'yellow', icon: '⚠️', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' },
  rejected:      { label: 'Rejected',       color: 'red',    icon: '❌', bg: 'bg-red-500/10',    border: 'border-red-500/30',    text: 'text-red-400' },
  manual_review: { label: 'Under Review',   color: 'blue',   icon: '🔍', bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   text: 'text-blue-400' },
};

const SECTION_CONFIG = {
  personal:  { label: 'Personal Information', icon: '👤' },
  financial: { label: 'Financial Details',    icon: '💰' },
  loan:      { label: 'Loan Details',         icon: '🏦' },
};

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-red-400';
  return (
    <span className={`text-[10px] font-bold ${color}`}>{pct}%</span>
  );
}

export default function ReviewPage() {
  const router = useRouter();
  const { reset } = useAppStore();
  const [data, setData] = useState<ReviewData | null>(null);
  const [activeSection, setActiveSection] = useState<'personal' | 'financial' | 'loan'>('personal');

  useEffect(() => {
    const raw = sessionStorage.getItem('kycReviewData');
    if (!raw) {
      // No data — go back
      router.push('/onboard/setup');
      return;
    }
    try {
      setData(JSON.parse(raw));
    } catch {
      router.push('/onboard/setup');
    }
  }, [router]);

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-white/40 text-sm animate-pulse">Loading your results...</div>
      </div>
    );
  }

  const { extractedFields, loanDecision } = data;
  const decision = loanDecision?.decision || 'manual_review';
  const config = DECISION_CONFIG[decision];
  const score = loanDecision?.score ?? 0;

  const fieldsBySection = {
    personal:  extractedFields.filter(f => f.section === 'personal'),
    financial: extractedFields.filter(f => f.section === 'financial'),
    loan:      extractedFields.filter(f => f.section === 'loan'),
  };

  const flaggedCount = extractedFields.filter(f => f.isFlagged).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-fade-in">
      <h1 className="text-3xl font-bold text-gradient mb-2 text-center">Application Summary</h1>
      <p className="text-center text-white/50 text-sm mb-8">
        Your KYC interview has been processed. Review the extracted information and loan decision below.
      </p>

      {/* ─── Loan Decision Card ──────────────────────────────────────────────── */}
      <div className={`rounded-2xl p-6 border ${config.bg} ${config.border} mb-8 relative overflow-hidden`}>
        {/* Subtle glow */}
        <div className={`absolute inset-0 opacity-10 bg-gradient-to-br ${
          decision === 'approved' ? 'from-green-500 to-emerald-600' :
          decision === 'rejected' ? 'from-red-500 to-rose-600' :
          decision === 'conditional' ? 'from-yellow-500 to-amber-600' :
          'from-blue-500 to-indigo-600'
        } pointer-events-none`} />

        <div className="relative flex flex-col md:flex-row gap-6 items-start md:items-center">
          {/* Decision badge */}
          <div className="flex flex-col items-center shrink-0">
            <div className="text-5xl mb-2">{config.icon}</div>
            <span className={`text-lg font-bold uppercase tracking-widest ${config.text}`}>
              {config.label}
            </span>
          </div>

          {/* Score gauge */}
          <div className="flex flex-col items-center shrink-0">
            <div className="relative w-20 h-20">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
                <circle
                  cx="18" cy="18" r="15.9" fill="none"
                  stroke={score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444'}
                  strokeWidth="2.5"
                  strokeDasharray={`${score} ${100 - score}`}
                  strokeLinecap="round"
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xl font-black text-white">{score}</span>
              </div>
            </div>
            <span className="text-xs text-white/40 mt-1">Credit Score</span>
          </div>

          {/* Summary & Reasons */}
          <div className="flex-1">
            {loanDecision?.llmAssessment?.summary && (
              <p className="text-white/80 text-sm mb-3 italic">"{loanDecision.llmAssessment.summary}"</p>
            )}

            {loanDecision?.reasons?.length > 0 && (
              <div className="mb-3">
                <p className="text-xs uppercase tracking-wider text-white/40 mb-1">Key Factors</p>
                <ul className="space-y-1">
                  {loanDecision.reasons.slice(0, 3).map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-white/70">
                      <span className="shrink-0 mt-0.5">•</span>{r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {loanDecision?.conditions?.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-amber-400/70 mb-1">Conditions</p>
                <ul className="space-y-1">
                  {loanDecision.conditions.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-amber-300/80">
                      <span className="shrink-0 mt-0.5">→</span>{c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Strengths / Risks row */}
        {loanDecision?.llmAssessment && (
          <div className="relative mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-green-400/70 mb-1">Strengths</p>
              {loanDecision.llmAssessment.strengths.length > 0 ? (
                <ul className="space-y-1">
                  {loanDecision.llmAssessment.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-white/60 flex gap-1.5">
                      <span className="text-green-400 shrink-0">✓</span>{s}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-white/30">None identified</p>}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-red-400/70 mb-1">Risks</p>
              {loanDecision.llmAssessment.risks.length > 0 ? (
                <ul className="space-y-1">
                  {loanDecision.llmAssessment.risks.map((r, i) => (
                    <li key={i} className="text-xs text-white/60 flex gap-1.5">
                      <span className="text-red-400 shrink-0">✗</span>{r}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-white/30">None identified</p>}
            </div>
          </div>
        )}
      </div>

      {/* ─── KYC Fields ─────────────────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl border border-white/10 overflow-hidden">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white/90">Extracted KYC Data</h2>
          {flaggedCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/30 rounded-full text-amber-300 text-xs font-semibold">
              {flaggedCount} field{flaggedCount > 1 ? 's' : ''} flagged
            </span>
          )}
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-white/10">
          {(Object.keys(SECTION_CONFIG) as ('personal' | 'financial' | 'loan')[]).map(sec => (
            <button
              key={sec}
              onClick={() => setActiveSection(sec)}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-all duration-200 ${
                activeSection === sec
                  ? 'bg-white/5 text-white border-b-2 border-blue-500'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {SECTION_CONFIG[sec].icon} {SECTION_CONFIG[sec].label}
            </button>
          ))}
        </div>

        {/* Fields grid */}
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(fieldsBySection[activeSection] || []).map(field => (
            <div
              key={field.key}
              className={`p-4 rounded-xl border transition-all duration-200 ${
                field.isFlagged
                  ? 'bg-amber-500/5 border-amber-500/30'
                  : 'bg-white/5 border-white/10'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">
                  {field.label}
                </span>
                <div className="flex items-center gap-1.5">
                  <ConfidenceBadge confidence={field.confidence} />
                  {field.isFlagged && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded font-bold">LOW CONF</span>
                  )}
                </div>
              </div>
              <p className="text-sm font-medium text-white">
                {field.finalValue ?? field.aiExtractedValue ?? (
                  <span className="text-white/30 italic">Not provided</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Actions ────────────────────────────────────────────────────────── */}
      <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
        <button
          className="btn-primary bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20"
          onClick={() => {
            sessionStorage.removeItem('kycReviewData');
            reset();
            router.push('/');
          }}
        >
          Back to Home
        </button>
        {decision !== 'rejected' && (
          <button
            className="btn-primary text-sm"
            onClick={() => {
              // In a real flow this would submit the application formally
              alert('Application submitted! Reference number will be emailed to you.');
            }}
          >
            Submit Application →
          </button>
        )}
      </div>
    </div>
  );
}
