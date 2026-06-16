'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';

export default function ApplicationDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  
  const [app, setApp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Officer Action State
  const [decision, setDecision] = useState<string>('');
  const [officerNote, setOfficerNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.push('/sign-in?redirect_url=/admin');
      return;
    }

    const fetchApp = async () => {
      try {
        const token = await getToken();
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
        
        const res = await fetch(`${API_URL}/admin/applications/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to fetch application');

        const data = await res.json();
        setApp(data.application);
        setDecision(data.application.status === 'under_review' || data.application.status === 'submitted' ? '' : data.application.status);
        setOfficerNote(data.application.officerNote || '');
      } catch (err: any) {
        setError(err.message || 'Error loading application');
      } finally {
        setLoading(false);
      }
    };

    fetchApp();
  }, [id, isLoaded, isSignedIn, getToken, router]);

  const handleSubmitDecision = async () => {
    if (!decision) {
      setSubmitError('Please select a decision');
      return;
    }
    
    setSubmitting(true);
    setSubmitError('');

    try {
      const token = await getToken();
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
      
      const res = await fetch(`${API_URL}/admin/applications/${id}/decision`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({
          status: decision,
          officerDecision: decision,
          officerNote: officerNote
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update decision');
      }

      router.push('/admin');
    } catch (err: any) {
      setSubmitError(err.message || 'Error saving decision');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !isLoaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-zinc-500">
          <div className="w-4 h-4 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
          <span className="text-sm font-medium">Loading details...</span>
        </div>
      </div>
    );
  }

  if (error || !app) {
    return <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"><span className="font-semibold">Error:</span> {error || 'Application not found'}</div>;
  }

  const session = app.sessionId || {};
  const loanDecision = session.loanDecision || {};
  const fraudSignals = session.fraudSignals || [];
  const fields = session.extractedAnswers || [];

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-emerald-500';
    if (score >= 40) return 'text-amber-500';
    return 'text-red-500';
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pb-20">
      <Link href="/admin" className="inline-flex items-center gap-2 text-zinc-400 hover:text-zinc-100 transition-colors mb-6 text-sm font-medium group">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:-translate-x-1 transition-transform"><path d="m15 18-6-6 6-6"/></svg>
        Back to Applications
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8 pb-6 border-b border-zinc-800">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight mb-2">Application #{app.referenceNumber}</h1>
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <span className="font-medium text-zinc-200">{app.userId?.name}</span>
            <span>•</span>
            <span>{app.userId?.email}</span>
            <span>•</span>
            <span>{new Date(app.createdAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          <span className="text-xs font-medium text-zinc-300 capitalize">{app.status.replace('_', ' ')}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column - AI Assessment & Details */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* AI Assessment Panel */}
          <section className="rounded-xl border border-zinc-800 bg-[#09090b] overflow-hidden">
            <div className="bg-zinc-900/50 px-5 py-4 border-b border-zinc-800 flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" className="text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
              <h2 className="text-sm font-medium text-zinc-100">AI Loan Assessment</h2>
            </div>
            
            <div className="p-5">
              {loanDecision.score !== undefined ? (
                <>
                  <div className="flex flex-col sm:flex-row gap-6 mb-6 pb-6 border-b border-zinc-800">
                    <div className="flex flex-col items-center justify-center min-w-[120px] p-4 rounded-lg bg-zinc-900/50 border border-zinc-800/50">
                      <span className={`text-4xl font-bold tracking-tight ${getScoreColor(loanDecision.score)}`}>
                        {loanDecision.score}
                      </span>
                      <span className="text-[10px] uppercase tracking-widest text-zinc-500 mt-1">Score</span>
                    </div>
                    <div className="flex flex-col justify-center">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-zinc-400">Recommendation:</span>
                        <span className={`text-sm font-semibold capitalize ${
                          loanDecision.decision === 'approved' ? 'text-emerald-500' :
                          loanDecision.decision === 'rejected' ? 'text-red-500' : 'text-amber-500'
                        }`}>{loanDecision.decision?.replace('_', ' ')}</span>
                      </div>
                      <p className="text-sm text-zinc-300 leading-relaxed">"{loanDecision.llmAssessment?.summary}"</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-500 mb-3 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
                        Strengths
                      </h3>
                      <ul className="space-y-2">
                        {loanDecision.llmAssessment?.strengths?.map((s: string, i: number) => (
                          <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                            <span className="text-emerald-500 mt-0.5">•</span>
                            <span className="leading-snug">{s}</span>
                          </li>
                        )) || <li className="text-sm text-zinc-500 italic">No specific strengths noted.</li>}
                      </ul>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-3 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                        Risks
                      </h3>
                      <ul className="space-y-2">
                        {loanDecision.llmAssessment?.risks?.map((r: string, i: number) => (
                          <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                            <span className="text-red-500 mt-0.5">•</span>
                            <span className="leading-snug">{r}</span>
                          </li>
                        )) || <li className="text-sm text-zinc-500 italic">No specific risks noted.</li>}
                      </ul>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-zinc-500 italic">No AI evaluation available for this application.</p>
              )}
            </div>
          </section>

          {/* KYC Data Panel */}
          <section className="rounded-xl border border-zinc-800 bg-[#09090b] overflow-hidden">
            <div className="bg-zinc-900/50 px-5 py-4 border-b border-zinc-800 flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" className="text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>
              <h2 className="text-sm font-medium text-zinc-100">Extracted KYC Data</h2>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {fields.map((f: any, i: number) => (
                  <div key={i} className="flex flex-col pb-3 border-b border-zinc-800/50 last:border-0">
                    <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">{f.label || f.key}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-200 font-medium">
                        {f.finalValue || f.aiExtractedValue || <span className="text-zinc-600 italic">Not provided</span>}
                      </span>
                      {f.isEdited && <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[9px] font-bold tracking-widest uppercase border border-blue-500/20">Edited</span>}
                    </div>
                  </div>
                ))}
                {fields.length === 0 && <p className="text-sm text-zinc-500 col-span-2 italic">No KYC data extracted.</p>}
              </div>
            </div>
          </section>
        </div>

        {/* Right Column - Fraud & Action */}
        <div className="flex flex-col gap-6">
          
          {/* Fraud Signals Panel */}
          <section className="rounded-xl border border-zinc-800 bg-[#09090b] overflow-hidden">
            <div className="bg-red-500/5 px-5 py-4 border-b border-zinc-800 flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" className="text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
              <h2 className="text-sm font-medium text-zinc-100">Fraud & Compliance</h2>
            </div>
            <div className="p-5">
              {fraudSignals.length > 0 ? (
                <ul className="space-y-3">
                  {fraudSignals.map((sig: any, i: number) => (
                    <li key={i} className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 text-sm flex flex-col gap-1">
                      <span className="font-semibold text-red-400 capitalize">{sig.type} • {sig.severity}</span>
                      <span className="text-zinc-400 text-xs leading-relaxed">{sig.description}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center gap-2 text-emerald-500 text-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <span>No fraud signals detected.</span>
                </div>
              )}
            </div>
          </section>

          {/* Action Panel */}
          <section className="rounded-xl border border-blue-500/20 bg-blue-500/5 overflow-hidden sticky top-20">
            <div className="bg-blue-500/10 px-5 py-4 border-b border-blue-500/20 flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" className="text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>
              <h2 className="text-sm font-medium text-blue-100">Officer Decision</h2>
            </div>
            <div className="p-5 space-y-4">
              
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Final Status</label>
                <select 
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                  className="w-full bg-[#09090b] border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                >
                  <option value="" disabled>Select decision...</option>
                  <option value="approved">Approve</option>
                  <option value="conditional">Conditional Approval</option>
                  <option value="rejected">Reject</option>
                  <option value="docs_requested">Request Documents</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Internal Note</label>
                <textarea 
                  value={officerNote}
                  onChange={(e) => setOfficerNote(e.target.value)}
                  placeholder="Justification or conditions..."
                  className="w-full bg-[#09090b] border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none h-24"
                />
              </div>

              {submitError && (
                <div className="p-3 rounded-lg bg-red-500/10 text-red-400 text-xs border border-red-500/20">
                  {submitError}
                </div>
              )}

              <button
                onClick={handleSubmitDecision}
                disabled={submitting}
                className="w-full py-2.5 mt-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Saving...' : 'Save Decision'}
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
