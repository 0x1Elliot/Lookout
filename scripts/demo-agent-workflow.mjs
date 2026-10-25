import { addInventoryItem, createEmptyInventoryState } from '../inventory.js';
import { createAgentInventoryContext } from '../server/agent-context.js';
import { createAgentWorkflowService } from '../server/agents/workflow.js';

let nextId = 0;
const idFactory = () => `demo-${++nextId}`;
const now = () => '2026-10-25T15:00:00.000Z';
let inventory = addInventoryItem(createEmptyInventoryState(), {
  name: 'Blue notebooks', count: 8, location: 'Back room A',
}, { idFactory, now });

const workflow = createAgentWorkflowService({ idFactory, now });
const demoEvent = {
  eventId: 'demo-cycle-count-001',
  occurredAt: '2026-10-25T14:55:00.000Z',
  source: 'demo/manual-cycle-count',
  type: 'inventory-count-observed',
  itemId: inventory.inventoryItems[0].id,
  observedQuantity: 5,
  evidence: [{
    id: 'demo-count-sheet-001',
    kind: 'manual-count-sheet',
    description: 'Synthetic demo count sheet records five units after a witnessed physical count.',
    observedAt: '2026-10-25T14:55:00.000Z',
    observedQuantity: 5,
  }],
};

const intake = workflow.intake(demoEvent);
const reconciliation = workflow.reconcile(intake.event.eventId, inventory);
const review = workflow.review(reconciliation.caseRecord.caseId, {
  decisionId: 'demo-review-decision-001',
  reviewerId: 'demo-human-reviewer',
  reviewerName: 'Demo reviewer (synthetic)',
  outcome: 'approve',
  rationale: 'Demo input: the reviewer checked the supplied synthetic count evidence.',
  decidedAt: '2026-10-25T15:01:00.000Z',
});
const action = workflow.act(review.caseRecord.caseId, { actionRequestId: 'demo-action-001' }, inventory);
inventory = action.inventory;

console.log('DETERMINISTIC FOUR-AGENT WORKFLOW DEMO — all event and reviewer data below are synthetic.');
console.log(JSON.stringify({
  eventIntake: { eventId: intake.event.eventId, source: intake.event.source, evidenceIds: intake.event.evidence.map(({ id }) => id) },
  reconciliation: {
    caseId: reconciliation.caseRecord.caseId,
    discrepancy: reconciliation.caseRecord.discrepancyType,
    observedFacts: reconciliation.caseRecord.observedFacts,
    inferences: reconciliation.caseRecord.inferences,
    unknowns: reconciliation.caseRecord.unknowns,
  },
  review: { outcome: review.caseRecord.review.outcome, reviewer: review.caseRecord.review.reviewerName },
  inventoryAction: action.action,
  subsequentContext: createAgentInventoryContext(inventory),
}, null, 2));
