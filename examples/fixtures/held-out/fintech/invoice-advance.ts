export interface InvoiceAdvanceApplication {
  invoiceFaceValueCents: number;
  daysUntilDue: number;
  customerPaymentHistoryScore: number;
  customerConcentrationShare: number;
  priorDilutionRate: number;
  activeDispute: boolean;
}

export interface InvoiceAdvanceDecision {
  advanceCents: number;
  feeCents: number;
  reserveCents: number;
  reviewLane: 'auto_approve' | 'risk_review' | 'decline';
}

const MAXIMUM_ADVANCE_RATE = 0.85;
const MINIMUM_ADVANCE_RATE = 0.55;
const MINIMUM_PAYMENT_HISTORY_SCORE = 0.72;
const CUSTOMER_CONCENTRATION_REVIEW_THRESHOLD = 0.4;
const BASE_FEE_BASIS_POINTS = 175;
const DAILY_DURATION_FEE_BASIS_POINTS = 2;
const DILUTION_RESERVE_RATE = 0.08;

export function priceInvoiceAdvance(application: InvoiceAdvanceApplication): InvoiceAdvanceDecision {
  if (application.invoiceFaceValueCents <= 0 || application.activeDispute) {
    return { advanceCents: 0, feeCents: 0, reserveCents: 0, reviewLane: 'decline' };
  }

  const dilutionAdjustment = Math.max(0, application.priorDilutionRate * 2);
  const concentrationAdjustment = Math.max(0, application.customerConcentrationShare * 0.15);
  const advanceRate = Math.max(
    MINIMUM_ADVANCE_RATE,
    Math.min(MAXIMUM_ADVANCE_RATE, MAXIMUM_ADVANCE_RATE - dilutionAdjustment - concentrationAdjustment),
  );
  const advanceCents = Math.floor(application.invoiceFaceValueCents * advanceRate);
  const reserveCents = Math.ceil(application.invoiceFaceValueCents * DILUTION_RESERVE_RATE);
  const durationFeeBasisPoints = Math.min(90, Math.max(0, application.daysUntilDue)) * DAILY_DURATION_FEE_BASIS_POINTS;
  const feeCents = Math.ceil((advanceCents * (BASE_FEE_BASIS_POINTS + durationFeeBasisPoints)) / 10_000);
  const reviewLane =
    application.customerPaymentHistoryScore < MINIMUM_PAYMENT_HISTORY_SCORE ||
    application.customerConcentrationShare > CUSTOMER_CONCENTRATION_REVIEW_THRESHOLD
      ? 'risk_review'
      : 'auto_approve';

  return { advanceCents, feeCents, reserveCents, reviewLane };
}
