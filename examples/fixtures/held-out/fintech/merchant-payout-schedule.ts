export interface MerchantPayoutAccount {
  availableSettlementCents: number;
  rollingReserveCents: number;
  pendingRefundCents: number;
  payoutFrequency: 'daily' | 'weekly';
  bankAccountVerified: boolean;
  complianceHold: boolean;
}

export interface MerchantPayoutPlan {
  payoutCents: number;
  deferredCents: number;
  schedule: 'blocked' | 'same_day' | 'next_business_day' | 'weekly';
  reviewRequired: boolean;
}

const OPERATING_BUFFER_CENTS = 50_000;
const SAME_DAY_PAYOUT_MINIMUM_CENTS = 500_000;

export function scheduleMerchantPayout(account: MerchantPayoutAccount): MerchantPayoutPlan {
  const availableSettlementCents = Math.max(0, account.availableSettlementCents);
  if (!account.bankAccountVerified || account.complianceHold) {
    return {
      payoutCents: 0,
      deferredCents: availableSettlementCents,
      schedule: 'blocked',
      reviewRequired: account.complianceHold,
    };
  }

  const protectedBalanceCents =
    Math.max(0, account.rollingReserveCents) +
    Math.max(0, account.pendingRefundCents) +
    OPERATING_BUFFER_CENTS;
  const payoutCents = Math.max(0, availableSettlementCents - protectedBalanceCents);
  const deferredCents = availableSettlementCents - payoutCents;

  if (account.payoutFrequency === 'weekly') {
    return { payoutCents, deferredCents, schedule: 'weekly', reviewRequired: false };
  }

  return {
    payoutCents,
    deferredCents,
    schedule: payoutCents >= SAME_DAY_PAYOUT_MINIMUM_CENTS ? 'same_day' : 'next_business_day',
    reviewRequired: false,
  };
}
