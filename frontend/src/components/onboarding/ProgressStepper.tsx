'use client';

import { usePathname } from 'next/navigation';
import React from 'react';

const steps = [
  { id: 'language',  label: 'Language',     path: '/onboard/language'  },
  { id: 'setup',     label: 'System Check', path: '/onboard/setup'     },
  { id: 'documents', label: 'Documents',    path: '/onboard/documents' },
  { id: 'consent',   label: 'Consent',      path: '/onboard/consent'   },
  { id: 'call',      label: 'Video Call',   path: '/onboard/call'      },
  { id: 'review',    label: 'Review',       path: '/onboard/review'    },
];

export default function ProgressStepper() {
  const pathname = usePathname();

  // Find current step index
  const currentIndex = steps.findIndex((step) => pathname?.includes(step.path));
  
  if (currentIndex === -1) return null; // Don't show if not in flow

  return (
    <div className="stepper-container">
      <div className="stepper-track">
        {steps.map((step, index) => {
          const isActive = index === currentIndex;
          const isCompleted = index < currentIndex;
          
          return (
            <div key={step.id} className="step-wrapper">
              <div className={`step-circle ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}>
                {isCompleted ? '✓' : index + 1}
              </div>
              <span className={`step-label ${isActive || isCompleted ? 'active-label' : ''}`}>
                {step.label}
              </span>
              {index < steps.length - 1 && (
                <div className={`step-line ${isCompleted ? 'completed-line' : ''}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
