import { adjustInventoryCount, normalizeInventoryState } from '../../inventory.js';
import { readAgentWorkflowState, requireIdentifier } from './contracts.js';

export function executeInventoryAction(caseIdValue, request, inventory, workflowValue, options = {}) {
  const caseId = requireIdentifier(caseIdValue, 'caseId');
  const workflow = readAgentWorkflowState(workflowValue);
  const record = workflow.cases.find((candidate) => candidate.caseId === caseId);
  if (!record) throw new Error('Reconciliation case was not found.');
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Action request must be an object.');
  const actionRequestId = requireIdentifier(request.actionRequestId, 'actionRequestId');
  const duplicate = workflow.actions.find((action) => action.actionRequestId === actionRequestId);
  if (duplicate) {
    if (duplicate.caseId !== caseId) throw new Error('actionRequestId already belongs to another case.');
    return { workflow, inventory, action: duplicate, duplicate: true };
  }
  if (record.action) throw new Error('An action has already been executed for this case.');
  if (!inventory || inventory.schemaVersion !== 2 || !Array.isArray(inventory.inventoryItems)
    || !Array.isArray(inventory.activity)) throw new Error('Inventory snapshot is incomplete or unsupported.');
  normalizeInventoryState(inventory);
  if (record.status !== 'approved' || record.review?.outcome !== 'approve') {
    throw new Error('An unresolved, rejected, or unapproved case cannot change inventory.');
  }
  if (!record.proposedAction || record.proposedAction.type !== 'set-verified-count') {
    throw new Error('The approved case has no supported inventory action.');
  }
  const action = record.proposedAction;
  const item = inventory.inventoryItems.find((candidate) => candidate.id === action.itemId);
  const currentRevision = item
    ? `${item.id}:${item.quantityOnHand}:${inventory.activity[0]?.id ?? 'no-activity'}:${inventory.activity.length}`
    : null;
  if (!item || item.quantityOnHand !== action.expectedQuantity || currentRevision !== record.inventoryRevision) {
    throw new Error('Inventory changed since reconciliation; reconcile the event again before acting.');
  }

  const updatedInventory = adjustInventoryCount(inventory, action.itemId, action.targetQuantity, {
    caseId,
    eventId: record.eventId,
    actionRequestId,
    reviewerId: record.review.reviewerId,
    evidenceIds: action.evidenceIds,
    ...options,
  });
  const result = {
    actionRequestId,
    caseId,
    eventId: record.eventId,
    itemId: action.itemId,
    previousQuantity: action.expectedQuantity,
    quantityOnHand: action.targetQuantity,
    reviewerId: record.review.reviewerId,
    evidenceIds: [...action.evidenceIds],
    status: 'completed',
    completedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
  const updatedCase = { ...record, status: 'completed', action: result };
  const updatedWorkflow = {
    ...workflow,
    cases: workflow.cases.map((candidate) => candidate.caseId === caseId ? updatedCase : candidate),
    actions: [...workflow.actions, result],
  };
  return { workflow: updatedWorkflow, inventory: updatedInventory, action: result, duplicate: false };
}
