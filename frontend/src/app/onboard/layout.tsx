import React from 'react';
import ProgressStepper from '@/components/onboarding/ProgressStepper';

export default function OnboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="onboard-wrapper">
      <div className="container" style={{ paddingTop: '2rem' }}>
        <ProgressStepper />
        <div className="onboard-content" style={{ marginTop: '3rem' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
