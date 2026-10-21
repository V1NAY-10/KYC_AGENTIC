import DocumentUpload from '@/components/onboarding/DocumentUpload';

export const metadata = {
  title: 'Upload Documents | KYC Onboarding',
  description: 'Upload your PAN card or Aadhaar card (at least one is required) before the video call.',
};

export default function DocumentsPage() {
  return <DocumentUpload />;
}
