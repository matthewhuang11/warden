import { describe, expect, it } from 'vitest';
import { scheduleMerchantPayout } from './fixtures/held-out/fintech/merchant-payout-schedule.js';
import { routeSpecialtyReferral } from './fixtures/held-out/healthtech/specialty-referral-routing.js';
import { assessCreditLine } from './fixtures/tuning/fintech/credit-line-policy.js';
import { calculateSettlementReserve } from './fixtures/tuning/fintech/settlement-reserve.js';
import { planTreasurySweep } from './fixtures/tuning/fintech/treasury-sweep.js';
import { prioritizeCareGap } from './fixtures/tuning/healthtech/care-gap-priority.js';
import { recommendAdherenceOutreach } from './fixtures/tuning/healthtech/adherence-outreach.js';
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

  it('protects reserves and refunds before scheduling a same-day payout', () => {
    expect(
      scheduleMerchantPayout({
        availableSettlementCents: 2_000_000,
        rollingReserveCents: 300_000,
        pendingRefundCents: 150_000,
        payoutFrequency: 'daily',
        bankAccountVerified: true,
        complianceHold: false,
      }),
    ).toEqual({ payoutCents: 1_500_000, deferredCents: 500_000, schedule: 'same_day', reviewRequired: false });
  });

  it('blocks payouts while a compliance hold is active', () => {
    expect(
      scheduleMerchantPayout({
        availableSettlementCents: 750_000,
        rollingReserveCents: 100_000,
        pendingRefundCents: 25_000,
        payoutFrequency: 'daily',
        bankAccountVerified: true,
        complianceHold: true,
      }),
    ).toEqual({ payoutCents: 0, deferredCents: 750_000, schedule: 'blocked', reviewRequired: true });
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

  it('expedites a high-acuity referral through care navigation', () => {
    expect(
      routeSpecialtyReferral({
        acuityScore: 0.9,
        symptomDurationDays: 120,
        failedFirstLineTreatments: 2,
        inNetworkSpecialistAvailable: false,
        priorReferralClosed: true,
        patientDeclined: false,
      }),
    ).toEqual({
      urgency: 'urgent',
      dueWithinDays: 2,
      route: 'care_navigation',
      clinicalReviewRequired: true,
    });
  });

  it('routes a persistent referral to an available specialist', () => {
    expect(
      routeSpecialtyReferral({
        acuityScore: 0.45,
        symptomDurationDays: 120,
        failedFirstLineTreatments: 3,
        inNetworkSpecialistAvailable: true,
        priorReferralClosed: false,
        patientDeclined: false,
      }),
    ).toEqual({
      urgency: 'priority',
      dueWithinDays: 7,
      route: 'in_network',
      clinicalReviewRequired: false,
    });
  });
});
