import { readAgentWorkflowState, requireIdentifier } from './contracts.js';

export function coordinateHumanReview(caseIdValue, input, workflowValue, { now = () => new Date().toISOString() } = {}) {
  const caseId = requireIdentifier(caseIdValue, 'caseId');
  const workflow = readAgentWorkflowState(workflowValue);
  const index = workflow.cases.findIndex((candidate) => candidate.caseId === caseId);
  if (index < 0) throw new Error('Reconciliation case was not found.');
  const record = workflow.cases[index];
  if (!record.reviewRequired) throw new Error('This case does not require human review.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Reviewer decision must be an object.');
  const decisionId = requireIdentifier(input.decisionId, 'decisionId');
  const reviewerId = requireIdentifier(input.reviewerId, 'reviewerId');
  const reviewerName = requireIdentifier(input.reviewerName, 'reviewerName');
  const rationale = requireIdentifier(input.rationale, 'rationale');
  if (!['approve', 'reject', 'request-more-information'].includes(input.outcome)) {
    throw new Error('Reviewer outcome must be approve, reject, or request-more-information.');
  }
  if (input.outcome === 'approve' && !record.proposedAction) {
    throw new Error('This case has no evidence-backed action that can be approved.');
  }
  if (record.review) {
    const prior = record.review;
    if (prior.decisionId === decisionId && prior.reviewerId === reviewerId && prior.reviewerName === reviewerName
      && prior.outcome === input.outcome && prior.rationale === rationale
      && (input.decidedAt === undefined || prior.decidedAt === input.decidedAt)) {
      return { workflow, caseRecord: record, duplicate: true };
    }
    if (record.status !== 'needs-information' || prior.outcome !== 'request-more-information') {
      throw new Error('A final reviewer decision is already recorded for this case.');
    }
  }
  if (input.outcome === 'approve' && !['awaiting-review', 'needs-information'].includes(record.status)) {
    throw new Error('Only an unresolved case can be approved.');
  }
  const review = { decisionId, reviewerId, reviewerName, outcome: input.outcome, rationale, decidedAt: input.decidedAt ?? now() };
  if (typeof review.decidedAt !== 'string' || !Number.isFinite(Date.parse(review.decidedAt))) {
    throw new Error('decidedAt must be a valid timestamp.');
  }
  const updated = {
    ...record,
    status: input.outcome === 'approve' ? 'approved' : input.outcome === 'reject' ? 'rejected' : 'needs-information',
    review: { ...review, input: { decisionId, reviewerId, reviewerName, outcome: input.outcome, rationale, decidedAt: review.decidedAt } },
    reviewHistory: [...(record.reviewHistory ?? []), { ...review }],
  };
  const cases = workflow.cases.map((candidate, candidateIndex) => candidateIndex === index ? updated : candidate);
  return { workflow: { ...workflow, cases }, caseRecord: updated, duplicate: false };
}
