import { chat } from './llm.service.js';

/**
 * Extract structured KYC fields from the full session transcript.
 * Called after the call ends.
 */
export async function extractKYCFromTranscript(transcript, language) {
  const transcriptText = transcript
    .map(t => `${t.role === 'agent' ? 'Aria' : 'User'}: ${t.text}`)
    .join('\n');

  const systemPrompt = `You are a KYC data extraction specialist. Extract all personal loan KYC fields from this interview transcript.

For each field, assess confidence based on how clearly it was stated.
Mark isFlagged: true if confidence is below 0.80.

Return ONLY valid JSON with this exact structure:
{
  "fields": [
    {
      "key": "fullName",
      "label": "Full Name",
      "section": "personal",
      "aiExtractedValue": "extracted value or null",
      "confidence": 0.95,
      "source": "verbal",
      "isFlagged": false
    }
  ]
}

Fields to extract (in order):
Personal: fullName, dateOfBirth, currentAddress, panNumber
Financial: monthlyIncome, employerName, employmentYears, existingEMI
Loan: loanAmount, loanPurpose, loanTenure

Rules:
- For monetary values, extract just the number (e.g., 85000 not "₹85,000")
- For dates, format as DD/MM/YYYY
- For tenure, extract in months (convert "3 years" to 36)
- If a field was not mentioned, set aiExtractedValue to null and confidence to 0
- Source is always "verbal" for this transcript-based extraction`;

  const result = await chat({
    systemPrompt,
    userMessage: `Interview Transcript:\n${transcriptText}`,
    json: true,
  });

  // Add section labels and locked flags
  const SECTION_MAP = {
    fullName: 'personal', dateOfBirth: 'personal', currentAddress: 'personal', panNumber: 'personal',
    monthlyIncome: 'financial', employerName: 'financial', employmentYears: 'financial', existingEMI: 'financial',
    loanAmount: 'loan', loanPurpose: 'loan', loanTenure: 'loan',
  };

  const LABEL_MAP = {
    fullName: 'Full Name', dateOfBirth: 'Date of Birth', currentAddress: 'Current Address', panNumber: 'PAN Number',
    monthlyIncome: 'Monthly Income (₹)', employerName: 'Employer Name', employmentYears: 'Years of Employment',
    existingEMI: 'Existing EMI (₹/month)', loanAmount: 'Loan Amount (₹)', loanPurpose: 'Loan Purpose', loanTenure: 'Loan Tenure (months)',
  };

  return (result.fields || []).map(f => ({
    ...f,
    label:      LABEL_MAP[f.key] || f.key,
    section:    SECTION_MAP[f.key] || 'personal',
    finalValue: f.aiExtractedValue,
    isEdited:   false,
    isLocked:   f.key === 'loanType', // loanType is always locked
  }));
}
