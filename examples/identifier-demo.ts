/**
 * Internal renewal logic for the confidential enterprise account workflow.
 * This comment should be redacted before the source reaches the model.
 */
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
