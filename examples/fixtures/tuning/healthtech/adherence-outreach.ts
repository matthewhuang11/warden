export interface MedicationAdherenceProfile {
  proportionOfDaysCovered: number;
  refillDaysOverdue: number;
  highRiskMedication: boolean;
  unsuccessfulContactAttempts: number;
  optedOut: boolean;
}

export interface OutreachRecommendation {
  priorityScore: number;
  channel: 'none' | 'message' | 'phone' | 'pharmacist';
  retryAfterDays: number;
}

const ADHERENCE_TARGET = 0.8;
const MAXIMUM_CONTACT_ATTEMPTS = 3;

export function recommendAdherenceOutreach(profile: MedicationAdherenceProfile): OutreachRecommendation {
  if (profile.optedOut || profile.proportionOfDaysCovered >= ADHERENCE_TARGET) {
    return { priorityScore: 0, channel: 'none', retryAfterDays: 0 };
  }

  const adherenceGap = Math.max(0, ADHERENCE_TARGET - profile.proportionOfDaysCovered);
  const adherenceScore = Math.round(adherenceGap * 100);
  const overdueScore = Math.min(30, Math.max(0, profile.refillDaysOverdue));
  const medicationRiskScore = profile.highRiskMedication ? 25 : 0;
  const priorityScore = Math.min(100, adherenceScore + overdueScore + medicationRiskScore);

  let channel: OutreachRecommendation['channel'] = profile.highRiskMedication ? 'pharmacist' : 'message';
  if (profile.unsuccessfulContactAttempts > 0 && !profile.highRiskMedication) channel = 'phone';
  if (profile.unsuccessfulContactAttempts >= MAXIMUM_CONTACT_ATTEMPTS) channel = 'none';

  return {
    priorityScore,
    channel,
    retryAfterDays: channel === 'none' ? 14 : 2,
  };
}
