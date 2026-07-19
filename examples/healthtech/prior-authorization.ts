export interface AuthorizationRequest {
  serviceCategory: 'imaging' | 'therapy' | 'procedure' | 'medication';
  requestedUnits: number;
  guidelineUnitLimit: number;
  conservativeTherapyCompleted: boolean;
  urgentClinicalNeed: boolean;
  documentationComplete: boolean;
}

export interface AuthorizationRoutingDecision {
  lane: 'auto_approve' | 'clinical_review' | 'documentation_hold' | 'expedited_review';
  approvedUnits: number;
  requiresPeerReview: boolean;
}

const PEER_REVIEW_CATEGORIES = new Set<AuthorizationRequest['serviceCategory']>(['procedure', 'medication']);

export function routeAuthorizationRequest(request: AuthorizationRequest): AuthorizationRoutingDecision {
  if (!request.documentationComplete) {
    return { lane: 'documentation_hold', approvedUnits: 0, requiresPeerReview: false };
  }

  const requestedWithinGuideline =
    request.requestedUnits > 0 && request.requestedUnits <= request.guidelineUnitLimit;
  const clinicalPrerequisitesMet = request.conservativeTherapyCompleted || request.serviceCategory === 'medication';

  if (request.urgentClinicalNeed) {
    return {
      lane: 'expedited_review',
      approvedUnits: 0,
      requiresPeerReview: PEER_REVIEW_CATEGORIES.has(request.serviceCategory),
    };
  }

  if (requestedWithinGuideline && clinicalPrerequisitesMet) {
    return { lane: 'auto_approve', approvedUnits: request.requestedUnits, requiresPeerReview: false };
  }

  return {
    lane: 'clinical_review',
    approvedUnits: 0,
    requiresPeerReview: PEER_REVIEW_CATEGORIES.has(request.serviceCategory),
  };
}
