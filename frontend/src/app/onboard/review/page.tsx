'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KYCField {
  key: string;
  label: string;
  section: 'personal' | 'financial' | 'loan';
  aiExtractedValue: any;
  finalValue: any;
  confidence: number;
  isFlagged: boolean;
  isEdited: boolean;
  isLocked?: boolean;
  source?: string;
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

// ─── Config ───────────────────────────────────────────────────────────────────

const DECISION_CONFIG = {
  approved:      { label: 'Approved',     icon: '✅', bg: 'from-green-500/20 to-emerald-500/10',  border: 'border-green-500/40',  text: 'text-green-400',  badge: 'bg-green-500/20 text-green-300' },
  conditional:   { label: 'Conditional',  icon: '⚠️', bg: 'from-yellow-500/20 to-amber-500/10',   border: 'border-yellow-500/40', text: 'text-yellow-400', badge: 'bg-yellow-500/20 text-yellow-300' },
  rejected:      { label: 'Rejected',     icon: '❌', bg: 'from-red-500/20 to-rose-500/10',       border: 'border-red-500/40',    text: 'text-red-400',    badge: 'bg-red-500/20 text-red-300' },
  manual_review: { label: 'Under Review', icon: '🔍', bg: 'from-blue-500/20 to-indigo-500/10',    border: 'border-blue-500/40',   text: 'text-blue-400',   badge: 'bg-blue-500/20 text-blue-300' },
};

const SECTION_CONFIG = {
  personal:  { label: 'Personal Information', icon: '👤', color: 'text-violet-400', border: 'border-violet-500/30' },
  financial: { label: 'Financial Details',    icon: '💰', color: 'text-blue-400',   border: 'border-blue-500/30'   },
  loan:      { label: 'Loan Details',         icon: '🏦', color: 'text-emerald-400', border: 'border-emerald-500/30' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidencePill({ confidence }: { confidence: number }) {
  const pct = Math.round((confidence ?? 0) * 100);
  const cls = pct >= 80 ? 'bg-green-500/20 text-green-300' : pct >= 60 ? 'bg-yellow-500/20 text-yellow-300' : 'bg-red-500/20 text-red-300';
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cls}`}>{pct}%</span>
  );
}

function FieldCard({
  field,
  onEdit,
}: {
  field: KYCField;
  onEdit: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(field.finalValue ?? field.aiExtractedValue ?? ''));

  const handleSave = () => {
    onEdit(field.key, inputVal);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  };

  const displayValue = field.finalValue ?? field.aiExtractedValue;

  return (
    <div className={`relative p-4 rounded-xl border transition-all duration-200 group ${
      field.isFlagged
        ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/50'
        : field.isEdited
        ? 'bg-blue-500/5 border-blue-500/30 hover:border-blue-500/50'
        : 'bg-white/5 border-white/10 hover:border-white/20'
    }`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">{field.label}</span>
        <div className="flex items-center gap-1.5">
          <ConfidencePill confidence={field.confidence} />
          {field.isFlagged && (
            <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded-full font-bold">LOW CONF</span>
          )}
          {field.isEdited && (
            <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded-full font-bold">EDITED</span>
          )}
        </div>
      </div>

      {/* Value / Edit input */}
      {editing ? (
        <div className="flex gap-2">
          <input
            autoFocus
            className="flex-1 bg-white/10 border border-blue-500/50 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={handleSave}
            className="px-3 py-1.5 rounded-lg bg-blue-500/80 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
          >
            Save
          </button>
        </div>
      ) : (
        <div className="flex items-end justify-between gap-2">
          <p className="text-sm font-medium text-white break-words min-h-[1.25rem]">
            {displayValue != null && displayValue !== ''
              ? String(displayValue)
              : <span className="text-white/30 italic">Not provided</span>
            }
          </p>
          {!field.isLocked && (
            <button
              onClick={() => {
                setInputVal(String(displayValue ?? ''));
                setEditing(true);
              }}
              className="opacity-0 group-hover:opacity-100 shrink-0 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white text-xs transition-all duration-150"
              title="Edit"
            >
              ✏️
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type PagePhase = 'review' | 'submitting' | 'decision';

export default function ReviewPage() {
  const router = useRouter();
  const { sessionId, reset } = useAppStore();

  const [fields, setFields] = useState<KYCField[]>([]);
  const [storedSessionId, setStoredSessionId] = useState<string>('');
  const [activeSection, setActiveSection] = useState<'personal' | 'financial' | 'loan'>('personal');
  const [phase, setPhase] = useState<PagePhase>('review');
  const [loanDecision, setLoanDecision] = useState<LoanDecision | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Load from sessionStorage ──────────────────────────────────────────────
  useEffect(() => {
    const raw = sessionStorage.getItem('kycReviewData');
    if (!raw) {
      router.push('/onboard/setup');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setFields(parsed.extractedFields ?? []);
      setStoredSessionId(parsed.sessionId ?? sessionId ?? '');
    } catch {
      router.push('/onboard/setup');
    }
  }, [router, sessionId]);

  // ── Edit handler ──────────────────────────────────────────────────────────
  const handleEdit = useCallback((key: string, value: string) => {
    setFields(prev =>
      prev.map(f =>
        f.key === key
          ? { ...f, finalValue: value, isEdited: true }
          : f
      )
    );
  }, []);

  // ── Submit to loan engine ─────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    setPhase('submitting');

    const sid = storedSessionId || sessionId;
    if (!sid) {
      setSubmitError('Session ID missing. Please restart the interview.');
      setPhase('review');
      return;
    }

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
      const res = await fetch(`${API_URL}/sessions/${sid}/submit-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ extractedFields: fields }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Submission failed. Please try again.');
      }

      const result = await res.json();
      setLoanDecision(result.loanDecision);
      setPhase('decision');
    } catch (err: any) {
      console.error('[ReviewPage] Submit error:', err);
      setSubmitError(err.message || 'An unexpected error occurred.');
      setPhase('review');
    }
  }, [fields, storedSessionId, sessionId]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const fieldsBySection = {
    personal:  fields.filter(f => f.section === 'personal'),
    financial: fields.filter(f => f.section === 'financial'),
    loan:      fields.filter(f => f.section === 'loan'),
  };
  const editedCount  = fields.filter(f => f.isEdited).length;
  const flaggedCount = fields.filter(f => f.isFlagged).length;

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: Submitting (loading overlay)
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'submitting') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 animate-fade-in">
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 rounded-full border-4 border-blue-500/20" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-2xl">🏦</div>
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">Processing Your Application</h2>
          <p className="text-white/50 text-sm">Our AI loan engine is evaluating your profile...</p>
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-blue-500 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: Success result
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'decision') {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 animate-fade-in text-center">
        <div className="text-7xl mb-6">✅</div>
        <h1 className="text-3xl font-black text-white mb-4">Application Submitted!</h1>
        <p className="text-white/60 mb-8">
          Your loan application has been successfully submitted and is currently under review by our Loan Officers. We will contact you with an update shortly.
        </p>
        <div className="flex justify-center gap-4">
          <button
            className="btn-primary"
            onClick={() => {
              sessionStorage.removeItem('kycReviewData');
              reset();
              router.push('/');
            }}
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: Review — editable form
  // ─────────────────────────────────────────────────────────────────────────
  if (fields.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-white/40 text-sm animate-pulse">Loading your results...</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-fade-in">

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gradient mb-2">Review Your Application</h1>
        <p className="text-white/50 text-sm max-w-xl mx-auto">
          Your interview has been processed. Review the information below — hover any field to edit it.
          Once you&apos;re happy, confirm to run the loan evaluation.
        </p>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-center gap-4 mb-8 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
          {fields.length} fields extracted
        </div>
        {flaggedCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
            ⚠️ {flaggedCount} low-confidence field{flaggedCount > 1 ? 's' : ''}
          </div>
        )}
        {editedCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">
            ✏️ {editedCount} field{editedCount > 1 ? 's' : ''} edited
          </div>
        )}
      </div>

      {/* Sections grid */}
      <div className="space-y-8 mb-10">
        {(Object.keys(SECTION_CONFIG) as Array<'personal' | 'financial' | 'loan'>).map(sec => {
          const cfg = SECTION_CONFIG[sec];
          const sectionFields = fieldsBySection[sec] || [];
          if (sectionFields.length === 0) return null;
          return (
            <div key={sec}>
              <div className={`flex items-center gap-2 mb-4 pb-2 border-b ${cfg.border}`}>
                <span className="text-lg">{cfg.icon}</span>
                <h2 className={`text-sm font-bold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</h2>
                <span className="ml-auto text-xs text-white/30">{sectionFields.length} fields</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sectionFields.map(field => (
                  <FieldCard key={field.key} field={field} onEdit={handleEdit} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Error */}
      {submitError && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center gap-3">
          <span className="text-xl shrink-0">⚠️</span>
          <span>{submitError}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <button
          className="btn-primary bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20"
          onClick={() => {
            sessionStorage.removeItem('kycReviewData');
            reset();
            router.push('/');
          }}
        >
          ✕ Cancel
        </button>
        <button
          id="confirm-submit-btn"
          className="btn-primary text-sm flex items-center justify-center gap-2 relative overflow-hidden group"
          onClick={handleSubmit}
        >
          <span className="relative z-10">✅ Confirm & Submit Application</span>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-violet-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        </button>
      </div>

      <p className="text-center text-white/25 text-xs mt-4">
        All edits are saved locally. Submitting will trigger the loan evaluation engine.
      </p>
    </div>
  );
}
