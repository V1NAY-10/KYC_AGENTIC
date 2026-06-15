'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useClerk } from '@clerk/nextjs';
import { useAppStore } from '@/store/useAppStore';
import api from '@/lib/api'; 

export default function ConsentForm() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { language, setSessionId } = useAppStore();
  
  const [recorded, setRecorded] = useState(false);
  const [dataUsage, setDataUsage] = useState(false);
  const [creditCheck, setCreditCheck] = useState(false);
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const allChecked = recorded && dataUsage && creditCheck && signature.trim().length > 2;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allChecked) return;

    setLoading(true);
    setError('');

    try {
      const token = await getToken();
      
      // Create session on the backend
      const res = await api.post('/sessions/start', {
        language: language || 'en',
        loanType: 'personal',
        consentData: {
          signedName: signature,
          userAgent: navigator.userAgent
        }
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data && res.data.sessionId) {
        setSessionId(res.data.sessionId);
        router.push('/onboard/call');
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err: any) {
      console.error(err);
      const errorMessage = err.response?.data?.error || 'Failed to start session. Please try again.';
      setError(errorMessage);
      setLoading(false);

      if (errorMessage.includes('User profile not found')) {
        setTimeout(() => {
          signOut({ redirectUrl: '/sign-in' });
        }, 2000);
      }
    }
  };

  const isHi = language === 'hi';

  return (
    <div className="flex-col flex-center animate-fade-in-up" style={{ width: '100%', maxWidth: '600px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }} className="text-gradient">
        {isHi ? 'डिजिटल सहमति' : 'Digital Consent'}
      </h2>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: '2rem', textAlign: 'center' }}>
        {isHi 
          ? 'आगे बढ़ने से पहले कृपया निम्नलिखित शर्तों को पढ़ें और सहमति दें।' 
          : 'Please review and agree to the following terms before proceeding.'}
      </p>

      <form onSubmit={handleSubmit} className="glass-card" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        <label style={{ display: 'flex', gap: '1rem', cursor: 'pointer', alignItems: 'flex-start' }}>
          <input 
            type="checkbox" 
            checked={recorded} 
            onChange={(e) => setRecorded(e.target.checked)}
            style={{ width: '20px', height: '20px', marginTop: '2px' }}
          />
          <span style={{ fontSize: '0.95rem' }}>
            {isHi 
              ? 'मैं समझता/समझती हूँ कि सुरक्षा और गुणवत्ता सुनिश्चित करने के लिए इस वीडियो कॉल को रिकॉर्ड किया जाएगा।' 
              : 'I understand that this video call will be recorded for security and quality assurance purposes.'}
          </span>
        </label>

        <label style={{ display: 'flex', gap: '1rem', cursor: 'pointer', alignItems: 'flex-start' }}>
          <input 
            type="checkbox" 
            checked={dataUsage} 
            onChange={(e) => setDataUsage(e.target.checked)}
            style={{ width: '20px', height: '20px', marginTop: '2px' }}
          />
          <span style={{ fontSize: '0.95rem' }}>
            {isHi 
              ? 'मैं अपने ऋण आवेदन को संसाधित करने के लिए अपने डेटा के उपयोग की सहमति देता/देती हूँ।' 
              : 'I consent to the use of my data for processing my loan application.'}
          </span>
        </label>

        <label style={{ display: 'flex', gap: '1rem', cursor: 'pointer', alignItems: 'flex-start' }}>
          <input 
            type="checkbox" 
            checked={creditCheck} 
            onChange={(e) => setCreditCheck(e.target.checked)}
            style={{ width: '20px', height: '20px', marginTop: '2px' }}
          />
          <span style={{ fontSize: '0.95rem' }}>
            {isHi 
              ? 'मैं संस्थान को मेरी क्रेडिट रिपोर्ट प्राप्त करने और समीक्षा करने के लिए अधिकृत करता/करती हूँ।' 
              : 'I authorize the institution to obtain and review my credit report.'}
          </span>
        </label>

        <hr style={{ borderColor: 'var(--color-border)', margin: '0.5rem 0' }} />

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
            {isHi ? 'हस्ताक्षर के रूप में अपना पूरा नाम टाइप करें:' : 'Type your full name as signature:'}
          </label>
          <input 
            type="text" 
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder={isHi ? 'उदा. विनय कुमार' : 'e.g. Vinay Kumar'}
            style={{ 
              width: '100%', 
              padding: '0.75rem', 
              borderRadius: '8px', 
              border: '1px solid var(--color-border)',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--color-text-primary)',
              fontSize: '1rem'
            }}
          />
        </div>

        {error && (
          <div style={{ color: 'var(--color-danger)', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <button 
          type="submit"
          className="btn-primary" 
          style={{ 
            marginTop: '1rem',
            opacity: allChecked && !loading ? 1 : 0.5, 
            cursor: allChecked && !loading ? 'pointer' : 'not-allowed' 
          }}
          disabled={!allChecked || loading}
        >
          {loading 
            ? (isHi ? 'प्रसंस्करण...' : 'Processing...') 
            : (isHi ? 'सहमति दें और कॉल शुरू करें ➔' : 'Agree & Start Call ➔')}
        </button>
      </form>
    </div>
  );
}
