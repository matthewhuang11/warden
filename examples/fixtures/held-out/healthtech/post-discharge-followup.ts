export interface DischargeEpisode {
  readmissionRiskScore: number;
  medicationChangesCount: number;
  emergencyVisitsLastSixMonths: number;
  hasPrimaryCareAppointment: boolean;
  transportationBarrier: boolean;
  declinedFollowUp: boolean;
}

export interface FollowUpPlan {
  dueWithinHours: number;
  channel: 'none' | 'portal_message' | 'nurse_call' | 'home_visit';
  medicationReconciliationRequired: boolean;
  escalationRequired: boolean;
}

const HIGH_READMISSION_RISK_THRESHOLD = 0.7;
const MODERATE_READMISSION_RISK_THRESHOLD = 0.4;
const REPEATED_EMERGENCY_VISIT_THRESHOLD = 2;

export function schedulePostDischargeFollowUp(episode: DischargeEpisode): FollowUpPlan {
  if (episode.declinedFollowUp) {
    return {
      dueWithinHours: 0,
      channel: 'none',
      medicationReconciliationRequired: false,
      escalationRequired: false,
    };
  }

  const highRisk = episode.readmissionRiskScore >= HIGH_READMISSION_RISK_THRESHOLD;
  const repeatedEmergencyUse = episode.emergencyVisitsLastSixMonths >= REPEATED_EMERGENCY_VISIT_THRESHOLD;
  const medicationReconciliationRequired = episode.medicationChangesCount > 0;
  const escalationRequired = highRisk || repeatedEmergencyUse || !episode.hasPrimaryCareAppointment;

  if (highRisk && episode.transportationBarrier) {
    return { dueWithinHours: 24, channel: 'home_visit', medicationReconciliationRequired, escalationRequired };
  }

  if (escalationRequired || episode.readmissionRiskScore >= MODERATE_READMISSION_RISK_THRESHOLD) {
    return { dueWithinHours: 48, channel: 'nurse_call', medicationReconciliationRequired, escalationRequired };
  }

  return {
    dueWithinHours: 120,
    channel: 'portal_message',
    medicationReconciliationRequired,
    escalationRequired: false,
  };
}
