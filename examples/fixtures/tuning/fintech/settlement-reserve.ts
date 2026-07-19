export interface MerchantSettlementProfile {
  trailingThirtyDayVolumeCents: number;
  disputeRate: number;
  refundRate: number;
  processingTenureDays: number;
  deliveryWindowDays: number;
}

export interface SettlementReserve {
  reserveBasisPoints: number;
  heldAmountCents: number;
  releaseDelayDays: number;
  manualReviewRequired: boolean;
}

const BASE_RESERVE_BASIS_POINTS = 150;
const NEW_MERCHANT_TENURE_DAYS = 90;
const NEW_MERCHANT_SURCHARGE_BASIS_POINTS = 200;
const DISPUTE_RATE_REVIEW_THRESHOLD = 0.012;
const MAXIMUM_RESERVE_BASIS_POINTS = 1_500;

export function calculateSettlementReserve(profile: MerchantSettlementProfile): SettlementReserve {
  const disputeComponent = Math.round(profile.disputeRate * 50_000);
  const refundComponent = Math.round(profile.refundRate * 10_000);
  const tenureComponent =
    profile.processingTenureDays < NEW_MERCHANT_TENURE_DAYS ? NEW_MERCHANT_SURCHARGE_BASIS_POINTS : 0;
  const reserveBasisPoints = Math.min(
    MAXIMUM_RESERVE_BASIS_POINTS,
    BASE_RESERVE_BASIS_POINTS + disputeComponent + refundComponent + tenureComponent,
  );
  const heldAmountCents = Math.ceil((profile.trailingThirtyDayVolumeCents * reserveBasisPoints) / 10_000);
  const releaseDelayDays = Math.max(2, Math.min(30, profile.deliveryWindowDays + 3));

  return {
    reserveBasisPoints,
    heldAmountCents,
    releaseDelayDays,
    manualReviewRequired: profile.disputeRate >= DISPUTE_RATE_REVIEW_THRESHOLD,
  };
}
