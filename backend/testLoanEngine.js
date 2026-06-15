import 'dotenv/config';

import { evaluateLoan } from './src/services/ai/loanEngine.service.js';

const mockFieldsHealthy = [
  { key: 'fullName', aiExtractedValue: 'John Doe', confidence: 0.95 },
  { key: 'dateOfBirth', aiExtractedValue: '1990-01-01', confidence: 0.90 },
  { key: 'currentAddress', aiExtractedValue: 'Mumbai, India', confidence: 0.90 },
  { key: 'panNumber', aiExtractedValue: 'ABCDE1234F', confidence: 0.95 },
  { key: 'monthlyIncome', aiExtractedValue: '75000', confidence: 0.95 },
  { key: 'employerName', aiExtractedValue: 'TCS', confidence: 0.95 },
  { key: 'employmentYears', aiExtractedValue: '3', confidence: 0.95 },
  { key: 'existingEMI', aiExtractedValue: '10000', confidence: 0.95 },
  { key: 'loanAmount', aiExtractedValue: '200000', confidence: 0.95 },
  { key: 'loanPurpose', aiExtractedValue: 'Home renovation', confidence: 0.95 },
  { key: 'loanTenure', aiExtractedValue: '24', confidence: 0.95 }
];

const mockFieldsUnhealthy = [
  { key: 'fullName', aiExtractedValue: 'Jane Smith', confidence: 0.95 },
  { key: 'dateOfBirth', aiExtractedValue: '1985-05-12', confidence: 0.90 },
  { key: 'currentAddress', aiExtractedValue: 'Delhi, India', confidence: 0.90 },
  { key: 'panNumber', aiExtractedValue: 'XYZWV5678A', confidence: 0.95 },
  { key: 'monthlyIncome', aiExtractedValue: '12000', confidence: 0.95 }, // Rule violation: < 15,000 (Min monthly income ₹15,000)
  { key: 'employerName', aiExtractedValue: 'Freelance', confidence: 0.95 },
  { key: 'employmentYears', aiExtractedValue: '0.2', confidence: 0.95 }, // Rule violation: < 6 months (employmentYears 0.2 yrs = 2.4 months)
  { key: 'existingEMI', aiExtractedValue: '8000', confidence: 0.95 },   // EMI burden = 8000 / 12000 = 66% (> 50%)
  { key: 'loanAmount', aiExtractedValue: '500000', confidence: 0.95 },   // Loan to income ratio = 500000 / 12000 = 41x (> 24x)
  { key: 'loanPurpose', aiExtractedValue: 'Vacation', confidence: 0.95 },
  { key: 'loanTenure', aiExtractedValue: '36', confidence: 0.95 }
];

async function runTests() {
  console.log("🚀 Starting Loan Engine Tests...\n");

  console.log("---------------------------------------------------------");
  console.log("📋 TEST 1: Healthy Profile (Expect Approved/Conditional)");
  console.log("---------------------------------------------------------");
  const decision1 = await evaluateLoan(mockFieldsHealthy, []);
  console.log(JSON.stringify(decision1, null, 2));

  console.log("\n---------------------------------------------------------");
  console.log("📋 TEST 2: High Risk Profile (Expect Rejected)");
  console.log("---------------------------------------------------------");
  const decision2 = await evaluateLoan(mockFieldsUnhealthy, []);
  console.log(JSON.stringify(decision2, null, 2));
}

runTests().catch(err => {
  console.error("Test failed:", err);
});
