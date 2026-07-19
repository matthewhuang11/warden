export interface SpecialtyReferralRequest {
  acuityScore: number;
  symptomDurationDays: number;
  failedFirstLineTreatments: number;
  inNetworkSpecialistAvailable: boolean;
  priorReferralClosed: boolean;
  patientDeclined: boolean;
}

export interface SpecialtyReferralPlan {
  urgency: 'none' | 'routine' | 'priority' | 'urgent';
  dueWithinDays: number;
  route: 'none' | 'in_network' | 'care_navigation';
  clinicalReviewRequired: boolean;
}

const URGENT_ACUITY_THRESHOLD = 0.8;
const PERSISTENT_SYMPTOM_THRESHOLD_DAYS = 90;
const MULTIPLE_TREATMENT_FAILURE_THRESHOLD = 2;

export function routeSpecialtyReferral(request: SpecialtyReferralRequest): SpecialtyReferralPlan {
  if (request.patientDeclined) {
    return { urgency: 'none', dueWithinDays: 0, route: 'none', clinicalReviewRequired: false };
  }

  const urgent = request.acuityScore >= URGENT_ACUITY_THRESHOLD;
  const persistentSymptoms = request.symptomDurationDays >= PERSISTENT_SYMPTOM_THRESHOLD_DAYS;
  const multipleTreatmentFailures =
    request.failedFirstLineTreatments >= MULTIPLE_TREATMENT_FAILURE_THRESHOLD;
  const priority = persistentSymptoms && multipleTreatmentFailures;
  const route = request.inNetworkSpecialistAvailable ? 'in_network' : 'care_navigation';

  if (urgent) {
    return {
      urgency: 'urgent',
      dueWithinDays: 2,
      route,
      clinicalReviewRequired: request.priorReferralClosed,
    };
  }

  if (priority) {
    return { urgency: 'priority', dueWithinDays: 7, route, clinicalReviewRequired: false };
  }

  return { urgency: 'routine', dueWithinDays: 30, route, clinicalReviewRequired: false };
}
