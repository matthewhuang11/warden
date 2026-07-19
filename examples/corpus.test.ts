import { describe, expect, it } from 'vitest';
import { priceInvoiceAdvance } from './fixtures/held-out/fintech/invoice-advance.js';
import { recommendAdherenceOutreach } from './fixtures/held-out/healthtech/adherence-outreach.js';
import { assessCreditLine } from './fixtures/tuning/fintech/credit-line-policy.js';
import { calculateSettlementReserve } from './fixtures/tuning/fintech/settlement-reserve.js';
import { planTreasurySweep } from './fixtures/tuning/fintech/treasury-sweep.js';
import { prioritizeCareGap } from './fixtures/tuning/healthtech/care-gap-priority.js';
import { routeAuthorizationRequest } from './fixtures/tuning/healthtech/prior-authorization.js';

describe('fintech fixture corpus', () => {
  it('caps a concentrated credit line and requests manual review', () => {
    expect(
      assessCreditLine({
        requestedLimitCents: 12_000_000,
        averageBankBalanceCents: 5_000_000,
        monthlyGrossProfitCents: 4_000_000,
        operatingHistoryMonths: 30,
        topCustomerRevenueShare: 0.42,
        unresolvedChargebacks: 0,
      }),
    ).toEqual({ approvedLimitCents: 7_000_000, limitingFactor: 'margin', manualReviewRequired: true });
  });

  it('declines businesses with unresolved chargebacks', () => {
    expect(
      assessCreditLine({
        requestedLimitCents: 1_000_000,
        averageBankBalanceCents: 1_000_000,
        monthlyGrossProfitCents: 1_000_000,
        operatingHistoryMonths: 18,
        topCustomerRevenueShare: 0.1,
        unresolvedChargebacks: 2,
      }),
    ).toEqual({ approvedLimitCents: 0, limitingFactor: 'chargebacks', manualReviewRequired: true });
  });

  it('declines businesses without enough operating history', () => {
    expect(
      assessCreditLine({
        requestedLimitCents: 1_000_000,
        averageBankBalanceCents: 1_000_000,
        monthlyGrossProfitCents: 1_000_000,
        operatingHistoryMonths: 5,
        topCustomerRevenueShare: 0.1,
        unresolvedChargebacks: 0,
      }),
    ).toEqual({ approvedLimitCents: 0, limitingFactor: 'history', manualReviewRequired: false });
  });

  it('prices a settlement reserve from disputes, refunds, and tenure', () => {
    expect(
      calculateSettlementReserve({
        trailingThirtyDayVolumeCents: 20_000_000,
        disputeRate: 0.008,
        refundRate: 0.04,
        processingTenureDays: 45,
        deliveryWindowDays: 7,
      }),
    ).toEqual({ reserveBasisPoints: 1_150, heldAmountCents: 2_300_000, releaseDelayDays: 10, manualReviewRequired: false });
  });

  it('caps reserve exposure and flags excessive disputes', () => {
    expect(
      calculateSettlementReserve({
        trailingThirtyDayVolumeCents: 10_000_000,
        disputeRate: 0.03,
        refundRate: 0.1,
        processingTenureDays: 20,
        deliveryWindowDays: 45,
      }),
    ).toEqual({ reserveBasisPoints: 1_500, heldAmountCents: 1_500_000, releaseDelayDays: 30, manualReviewRequired: true });
  });

  it('retains required liquidity before sweeping excess cash', () => {
    expect(
      planTreasurySweep({
        availableBalanceCents: 10_000_000,
        pendingDebitCents: 1_000_000,
        nextPayrollCents: 2_000_000,
        minimumOperatingBalanceCents: 2_500_000,
        destinationCapacityCents: 5_000_000,
      }),
    ).toEqual({ transferCents: 5_000_000, retainedBalanceCents: 5_000_000, reason: 'capacity_limit' });
  });

  it('does not sweep through the operating buffer', () => {
    expect(
      planTreasurySweep({
        availableBalanceCents: 3_000_000,
        pendingDebitCents: 1_000_000,
        nextPayrollCents: 2_000_000,
        minimumOperatingBalanceCents: 2_500_000,
        destinationCapacityCents: 5_000_000,
      }),
    ).toEqual({ transferCents: 0, retainedBalanceCents: 3_000_000, reason: 'insufficient_buffer' });
  });

  it('prices an invoice advance from dilution, concentration, and duration risk', () => {
    expect(
      priceInvoiceAdvance({
        invoiceFaceValueCents: 10_000_000,
        daysUntilDue: 45,
        customerPaymentHistoryScore: 0.9,
        customerConcentrationShare: 0.2,
        priorDilutionRate: 0.03,
        activeDispute: false,
      }),
    ).toEqual({ advanceCents: 7_600_000, feeCents: 201_400, reserveCents: 800_000, reviewLane: 'auto_approve' });
  });

  it('declines advances against disputed invoices', () => {
    expect(
      priceInvoiceAdvance({
        invoiceFaceValueCents: 10_000_000,
        daysUntilDue: 30,
        customerPaymentHistoryScore: 0.9,
        customerConcentrationShare: 0.1,
        priorDilutionRate: 0.01,
        activeDispute: true,
      }),
    ).toEqual({ advanceCents: 0, feeCents: 0, reserveCents: 0, reviewLane: 'decline' });
  });
});

describe('healthtech fixture corpus', () => {
  it('escalates a high-risk overdue care gap', () => {
    expect(
      prioritizeCareGap({
        daysOverdue: 240,
        clinicalRiskWeight: 1.5,
        emergencyVisitsLastYear: 2,
        missedAppointmentsLastYear: 1,
        alreadyScheduled: false,
      }),
    ).toEqual({ score: 83, outreachTier: 'urgent' });
  });

  it('removes scheduled patients from care-gap outreach', () => {
    expect(
      prioritizeCareGap({
        daysOverdue: 90,
        clinicalRiskWeight: 2,
        emergencyVisitsLastYear: 1,
        missedAppointmentsLastYear: 0,
        alreadyScheduled: true,
      }),
    ).toEqual({ score: 0, outreachTier: 'none' });
  });

  it('auto-approves documented requests within guideline limits', () => {
    expect(
      routeAuthorizationRequest({
        serviceCategory: 'therapy',
        requestedUnits: 8,
        guidelineUnitLimit: 12,
        conservativeTherapyCompleted: true,
        urgentClinicalNeed: false,
        documentationComplete: true,
      }),
    ).toEqual({ lane: 'auto_approve', approvedUnits: 8, requiresPeerReview: false });
  });

  it('routes urgent procedures to expedited peer review', () => {
    expect(
      routeAuthorizationRequest({
        serviceCategory: 'procedure',
        requestedUnits: 1,
        guidelineUnitLimit: 1,
        conservativeTherapyCompleted: false,
        urgentClinicalNeed: true,
        documentationComplete: true,
      }),
    ).toEqual({ lane: 'expedited_review', approvedUnits: 0, requiresPeerReview: true });
  });

  it('routes high-risk medication gaps to a pharmacist', () => {
    expect(
      recommendAdherenceOutreach({
        proportionOfDaysCovered: 0.62,
        refillDaysOverdue: 12,
        highRiskMedication: true,
        unsuccessfulContactAttempts: 1,
        optedOut: false,
      }),
    ).toEqual({ priorityScore: 55, channel: 'pharmacist', retryAfterDays: 2 });
  });

  it('honors outreach opt-outs', () => {
    expect(
      recommendAdherenceOutreach({
        proportionOfDaysCovered: 0.4,
        refillDaysOverdue: 20,
        highRiskMedication: true,
        unsuccessfulContactAttempts: 0,
        optedOut: true,
      }),
    ).toEqual({ priorityScore: 0, channel: 'none', retryAfterDays: 0 });
  });

  it('pauses outreach after repeated unsuccessful contacts', () => {
    expect(
      recommendAdherenceOutreach({
        proportionOfDaysCovered: 0.65,
        refillDaysOverdue: 8,
        highRiskMedication: false,
        unsuccessfulContactAttempts: 3,
        optedOut: false,
      }),
    ).toEqual({ priorityScore: 23, channel: 'none', retryAfterDays: 14 });
  });
});
