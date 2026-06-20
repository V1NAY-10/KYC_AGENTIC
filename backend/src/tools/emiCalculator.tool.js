/**
 * EMI Calculator Tool
 *
 * Pure deterministic math — no external API needed.
 * Formula: EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)
 *   P = principal
 *   r = monthly interest rate (annualRate / 12 / 100)
 *   n = tenure in months
 */
export const emiCalculatorTool = {
  name: 'calculate_emi',
  description: 'Calculates monthly EMI, total payable amount, and total interest for a personal loan.',
  parameters: {
    principal:         { type: 'number', description: 'Loan principal amount in INR' },
    annualRatePercent: { type: 'number', description: 'Annual interest rate in percent (e.g., 12 for 12%). Defaults to 12.' },
    tenureMonths:      { type: 'number', description: 'Loan repayment tenure in months' },
  },

  execute: async ({ principal, annualRatePercent = 12, tenureMonths }) => {
    const P = parseFloat(principal);
    const r = parseFloat(annualRatePercent) / 12 / 100; // monthly rate
    const n = parseInt(tenureMonths, 10);

    if (!P || P <= 0 || !n || n <= 0) {
      return { error: 'Invalid principal or tenure', monthlyEMI: null };
    }

    let emi;
    if (r === 0) {
      // Edge case: 0% interest
      emi = P / n;
    } else {
      const factor = Math.pow(1 + r, n);
      emi = (P * r * factor) / (factor - 1);
    }

    const totalPayable  = emi * n;
    const totalInterest = totalPayable - P;
    const affordabilityNote =
      emi > 50000
        ? 'High EMI — verify against stated income'
        : emi > 20000
        ? 'Moderate EMI'
        : 'Manageable EMI';

    return {
      monthlyEMI:        Math.round(emi),
      totalPayable:      Math.round(totalPayable),
      totalInterest:     Math.round(totalInterest),
      principalAmount:   P,
      tenureMonths:      n,
      annualRatePercent: parseFloat(annualRatePercent),
      affordabilityNote,
    };
  },
};
