import DocumentUpload from '@/components/onboarding/DocumentUpload';

export const metadata = {
  title: 'Upload Documents | KYC Onboarding',
  description: 'Optionally upload your KYC documents (PAN card, Aadhaar) before the video call.',
};

export default function DocumentsPage() {
  return <DocumentUpload />;
}
