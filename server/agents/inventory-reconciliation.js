import { createAgentInventoryContext } from '../agent-context.js';
import { normalizeInventoryState } from '../../inventory.js';
import { readAgentWorkflowState, requireIdentifier } from './contracts.js';

export function reconcileStoreEvent(eventIdValue, inventory, workflowValue) {
  const eventId = requireIdentifier(eventIdValue, 'eventId');
  const workflow = readAgentWorkflowState(workflowValue);
  const event = workflow.events.find((candidate) => candidate.eventId === eventId);
  if (!event) throw new Error('Validated event was not found.');

  const caseId = `case:${event.eventId}`;
  const existing = workflow.cases.find((candidate) => candidate.caseId === caseId);
  if (existing) return { workflow, caseRecord: existing, duplicate: true };

  const context = createAgentInventoryContext(inventory);
  normalizeInventoryState(inventory);
  const item = event.itemId === null ? undefined : context.items.find((candidate) => candidate.id === event.itemId);
  const facts = [{ kind: 'observed', statement: `Store event ${event.eventId} was reported by ${event.source} at ${event.occurredAt}.`, evidenceIds: event.evidence.map(({ id }) => id) }];
  const unknowns = [];
  let proposedAction = null;
  let discrepancy = false;
  let discrepancyType = null;

  if (event.itemId === null) unknowns.push('The event does not identify an inventory item.');
  else if (!item) {
    discrepancy = true;
    discrepancyType = 'unmatched-inventory-item';
    unknowns.push('The referenced item is not present in the supplied inventory snapshot.');
  } else if (event.observedQuantity === null) {
    unknowns.push('The physical count is unknown.');
  } else {
    facts.push({ kind: 'observed', statement: `Recorded on-hand quantity is ${item.quantityOnHand}.`, evidenceIds: [] });
    facts.push({ kind: 'observed', statement: `The supplied count evidence reports ${event.observedQuantity} units.`, evidenceIds: event.evidence.map(({ id }) => id) });
    if (item.quantityOnHand !== event.observedQuantity) {
      discrepancy = true;
      discrepancyType = 'count-variance';
      facts.push({ kind: 'inferred', statement: `Recorded and observed counts differ by ${event.observedQuantity - item.quantityOnHand} units.`, evidenceIds: event.evidence.map(({ id }) => id) });
      unknowns.push('The cause of the count variance is unknown.');
      proposedAction = {
        type: 'set-verified-count',
        itemId: item.id,
        expectedQuantity: item.quantityOnHand,
        targetQuantity: event.observedQuantity,
        evidenceIds: event.evidence.map(({ id }) => id),
      };
    }
  }

  const caseRecord = {
    caseId,
    eventId: event.eventId,
    stage: 'reconciled',
    status: discrepancy ? 'awaiting-review' : unknowns.length ? 'needs-information' : 'no-action',
    discrepancy,
    discrepancyType,
    observedFacts: facts.filter(({ kind }) => kind === 'observed'),
    inferences: facts.filter(({ kind }) => kind === 'inferred'),
    unknowns,
    requestedDecision: proposedAction ? 'Review whether to apply the evidence-backed physical count.' : null,
    proposedAction,
    reviewRequired: discrepancy || unknowns.length > 0,
    inventoryRevision: item ? `${item.id}:${item.quantityOnHand}:${inventory.activity[0]?.id ?? 'no-activity'}:${inventory.activity.length}` : null,
    review: null,
    reviewHistory: [],
    action: null,
  };
  return { workflow: { ...workflow, cases: [...workflow.cases, caseRecord] }, caseRecord, duplicate: false };
}
