import { intakeStoreEvent } from './event-intake.js';
import { reconcileStoreEvent } from './inventory-reconciliation.js';
import { coordinateHumanReview } from './review-coordination.js';
import { executeInventoryAction } from './inventory-action.js';
import { readAgentWorkflowState } from './contracts.js';

export function createAgentWorkflowService(options = {}) {
  let workflow = readAgentWorkflowState();
  const executedInventories = new Map();

  return Object.freeze({
    getState() { return structuredClone(workflow); },
    intake(event) {
      const result = intakeStoreEvent(event, workflow);
      workflow = result.workflow;
      return structuredClone(result);
    },
    reconcile(eventId, inventory) {
      const result = reconcileStoreEvent(eventId, inventory, workflow);
      workflow = result.workflow;
      return structuredClone(result);
    },
    review(caseId, decision) {
      const result = coordinateHumanReview(caseId, decision, workflow, options);
      workflow = result.workflow;
      return structuredClone(result);
    },
    act(caseId, request, inventory) {
      const requestId = request?.actionRequestId;
      const result = executeInventoryAction(caseId, request, inventory, workflow, options);
      workflow = result.workflow;
      if (!result.duplicate) executedInventories.set(requestId, result.inventory);
      const response = result.duplicate && executedInventories.has(requestId)
        ? { ...result, inventory: executedInventories.get(requestId) }
        : result;
      return structuredClone(response);
    },
  });
}
