export interface CreditLineApplication {
  requestedLimitCents: number;
  averageBankBalanceCents: number;
  monthlyGrossProfitCents: number;
  operatingHistoryMonths: number;
  topCustomerRevenueShare: number;
  unresolvedChargebacks: number;
}

export interface CreditLineDecision {
  approvedLimitCents: number;
  limitingFactor: 'history' | 'chargebacks' | 'liquidity' | 'margin' | 'requested';
  manualReviewRequired: boolean;
}

const MINIMUM_OPERATING_HISTORY_MONTHS = 6;
const MAXIMUM_GROSS_PROFIT_MULTIPLE = 2.5;
const MAXIMUM_BALANCE_MULTIPLE = 3;
const CUSTOMER_CONCENTRATION_THRESHOLD = 0.35;
const CUSTOMER_CONCENTRATION_DISCOUNT = 0.7;

export function assessCreditLine(application: CreditLineApplication): CreditLineDecision {
  if (application.operatingHistoryMonths < MINIMUM_OPERATING_HISTORY_MONTHS) {
    return { approvedLimitCents: 0, limitingFactor: 'history', manualReviewRequired: false };
  }

  if (application.unresolvedChargebacks > 0) {
    return { approvedLimitCents: 0, limitingFactor: 'chargebacks', manualReviewRequired: true };
  }

  const liquidityCapacity = application.averageBankBalanceCents * MAXIMUM_BALANCE_MULTIPLE;
  const marginCapacity = application.monthlyGrossProfitCents * MAXIMUM_GROSS_PROFIT_MULTIPLE;
  const concentrationAdjustment =
    application.topCustomerRevenueShare > CUSTOMER_CONCENTRATION_THRESHOLD
      ? CUSTOMER_CONCENTRATION_DISCOUNT
      : 1;
  const policyCapacity = Math.floor(Math.min(liquidityCapacity, marginCapacity) * concentrationAdjustment);
  const approvedLimitCents = Math.max(0, Math.min(application.requestedLimitCents, policyCapacity));

  let limitingFactor: CreditLineDecision['limitingFactor'] = 'requested';
  if (approvedLimitCents < application.requestedLimitCents) {
    limitingFactor = liquidityCapacity <= marginCapacity ? 'liquidity' : 'margin';
  }

  return {
    approvedLimitCents,
    limitingFactor,
    manualReviewRequired: application.topCustomerRevenueShare > CUSTOMER_CONCENTRATION_THRESHOLD,
  };
}
