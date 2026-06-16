'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

interface Application {
  _id: string;
  referenceNumber: string;
  status: string;
  loanType: string;
  loanAmount: number | null;
  createdAt: string;
  userId: {
    _id: string;
    name: string;
    email: string;
  };
}

export default function AdminDashboardPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.push('/sign-in?redirect_url=/admin');
      return;
    }

    const fetchApplications = async () => {
      try {
        const token = await getToken();
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
        
        const res = await fetch(`${API_URL}/admin/applications`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          if (res.status === 403) {
            router.push('/officer-signup'); // Not an officer
            return;
          }
          throw new Error('Failed to fetch applications');
        }

        const data = await res.json();
        setApplications(data.applications || []);
      } catch (err: any) {
        setError(err.message || 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchApplications();
  }, [isLoaded, isSignedIn, getToken, router]);

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'submitted':
      case 'under_review':
        return <span className="inline-flex items-center px-2 py-1 rounded-md bg-amber-500/10 text-amber-500 text-xs font-medium ring-1 ring-inset ring-amber-500/20">Review</span>;
      case 'approved':
        return <span className="inline-flex items-center px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500 text-xs font-medium ring-1 ring-inset ring-emerald-500/20">Approved</span>;
      case 'rejected':
        return <span className="inline-flex items-center px-2 py-1 rounded-md bg-red-500/10 text-red-500 text-xs font-medium ring-1 ring-inset ring-red-500/20">Rejected</span>;
      case 'conditional':
        return <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-500/10 text-blue-500 text-xs font-medium ring-1 ring-inset ring-blue-500/20">Conditional</span>;
      default:
        return <span className="inline-flex items-center px-2 py-1 rounded-md bg-zinc-500/10 text-zinc-400 text-xs font-medium ring-1 ring-inset ring-zinc-500/20">{status}</span>;
    }
  };

  if (loading || !isLoaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-zinc-500">
          <div className="w-4 h-4 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
          <span className="text-sm font-medium">Loading applications...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
        <span className="font-semibold">Error:</span> {error}
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
      
      {/* Header & Metrics */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight mb-1">Applications</h1>
          <p className="text-zinc-500 text-sm">Review and manage pending KYC applications.</p>
        </div>
        
        <div className="flex gap-4">
          <div className="px-4 py-3 rounded-xl bg-[#09090b] border border-zinc-800 flex items-center gap-4 min-w-[140px]">
            <div className="p-2 rounded-lg bg-zinc-800 text-zinc-300">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-zinc-500 font-medium">Total</span>
              <span className="text-lg font-semibold text-zinc-100 leading-none mt-0.5">{applications.length}</span>
            </div>
          </div>
          
          <div className="px-4 py-3 rounded-xl bg-[#09090b] border border-zinc-800 flex items-center gap-4 min-w-[140px]">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-zinc-500 font-medium">Pending</span>
              <span className="text-lg font-semibold text-zinc-100 leading-none mt-0.5">
                {applications.filter(a => a.status === 'under_review' || a.status === 'submitted').length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="rounded-xl border border-zinc-800 bg-[#09090b] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-zinc-900/50 border-b border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium text-zinc-400">Reference</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Applicant</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Type</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Amount</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Date</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Status</th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {applications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    No applications found.
                  </td>
                </tr>
              ) : (
                applications.map((app) => (
                  <tr key={app._id} className="hover:bg-zinc-800/30 transition-colors group">
                    <td className="px-4 py-3 font-medium text-zinc-300">{app.referenceNumber}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-zinc-200">{app.userId?.name || 'Unknown'}</span>
                        <span className="text-xs text-zinc-500">{app.userId?.email || 'N/A'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 capitalize">{app.loanType}</td>
                    <td className="px-4 py-3 text-zinc-300 font-medium">
                      {app.loanAmount ? `$${app.loanAmount.toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {new Date(app.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(app.status)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link 
                        href={`/admin/applications/${app._id}`}
                        className="inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
