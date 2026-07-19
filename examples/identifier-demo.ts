/** Keeps renewal calculations isolated from the caller. */
export interface CustomerRenewalRecord {
  accountRiskMultiplier: number;
  annualRevenue: number;
  renewalWindowDays: number;
}

const CONFIDENTIAL_PRICING_MESSAGE = 'Internal enterprise renewal multiplier for strategic accounts';
const RENEWAL_PROCESSING_FEE = CONFIDENTIAL_PRICING_MESSAGE.length;

export function calculateRenewalOffer(record: CustomerRenewalRecord): number {
  const isEligible = record.annualRevenue > 0 && record.renewalWindowDays >= 1;
  if (!isEligible) return 0;

  return record.annualRevenue * record.accountRiskMultiplier + RENEWAL_PROCESSING_FEE;
}
