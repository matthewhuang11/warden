export interface CareGapRecord {
  daysOverdue: number;
  clinicalRiskWeight: number;
  emergencyVisitsLastYear: number;
  missedAppointmentsLastYear: number;
  alreadyScheduled: boolean;
}

export interface CareGapPriority {
  score: number;
  outreachTier: 'none' | 'routine' | 'priority' | 'urgent';
}

const MAXIMUM_PRIORITY_SCORE = 100;
const OVERDUE_DAY_WEIGHT = 0.15;
const EMERGENCY_VISIT_WEIGHT = 8;
const MISSED_APPOINTMENT_WEIGHT = 3;

export function prioritizeCareGap(record: CareGapRecord): CareGapPriority {
  if (record.alreadyScheduled || record.daysOverdue <= 0) {
    return { score: 0, outreachTier: 'none' };
  }

  const overdueScore = record.daysOverdue * OVERDUE_DAY_WEIGHT;
  const utilizationScore = record.emergencyVisitsLastYear * EMERGENCY_VISIT_WEIGHT;
  const accessBarrierScore = record.missedAppointmentsLastYear * MISSED_APPOINTMENT_WEIGHT;
  const score = Math.max(
    0,
    Math.min(
      MAXIMUM_PRIORITY_SCORE,
      Math.round((overdueScore + utilizationScore + accessBarrierScore) * record.clinicalRiskWeight),
    ),
  );

  let outreachTier: CareGapPriority['outreachTier'] = 'routine';
  if (score >= 75) outreachTier = 'urgent';
  else if (score >= 40) outreachTier = 'priority';

  return { score, outreachTier };
}
