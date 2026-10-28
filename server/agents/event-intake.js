import { requireIdentifier, readAgentWorkflowState, canonicalJson } from './contracts.js';

function validateEvidence(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error('At least one and at most 50 evidence records are required.');
  }
  const ids = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Evidence record is malformed.');
    const id = requireIdentifier(entry.id, 'Evidence ID');
    const kind = requireIdentifier(entry.kind, 'Evidence kind');
    const description = requireIdentifier(entry.description, 'Evidence description');
    if (ids.has(id)) throw new Error('Evidence IDs must be unique within an event.');
    ids.add(id);
    const observedAt = entry.observedAt;
    if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
      throw new Error('Evidence observedAt must be a valid timestamp.');
    }
    const evidence = { id, kind, description, observedAt };
    if (Object.hasOwn(entry, 'observedQuantity')) {
      if (entry.observedQuantity !== null && (!Number.isSafeInteger(entry.observedQuantity) || entry.observedQuantity < 0)) {
        throw new Error('Evidence observedQuantity must be a non-negative whole number or null.');
      }
      evidence.observedQuantity = entry.observedQuantity;
    }
    return evidence;
  });
}

export function validateStoreEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Store event must be an object.');
  const eventId = requireIdentifier(input.eventId, 'eventId');
  if (eventId.length > 195) throw new Error('eventId must be at most 195 characters so its case ID remains within contract limits.');
  const occurredAt = input.occurredAt;
  if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt))) {
    throw new Error('occurredAt must be a valid timestamp.');
  }
  const source = requireIdentifier(input.source, 'source');
  const type = requireIdentifier(input.type, 'type');
  if (type !== 'inventory-count-observed') throw new Error('Unsupported store event type.');
  const itemId = input.itemId === null ? null : requireIdentifier(input.itemId, 'itemId');
  const observedQuantity = input.observedQuantity;
  if (observedQuantity !== null && (!Number.isSafeInteger(observedQuantity) || observedQuantity < 0)) {
    throw new Error('observedQuantity must be a non-negative whole number or null when unknown.');
  }
  const evidence = validateEvidence(input.evidence).map((entry) => Object.freeze(entry));
  const evidenceCounts = new Set(evidence.filter((entry) => Number.isSafeInteger(entry.observedQuantity))
    .map((entry) => entry.observedQuantity));
  if (evidenceCounts.size > 1) throw new Error('Supporting evidence contains conflicting physical counts.');
  if (observedQuantity !== null && !evidenceCounts.has(observedQuantity)) {
    throw new Error('A reported count must match a count explicitly recorded in supporting evidence.');
  }
  if (observedQuantity === null && evidenceCounts.size > 0) {
    throw new Error('A count cannot be marked unknown when supporting evidence records a physical count.');
  }
  return Object.freeze({
    eventId,
    occurredAt,
    source,
    type,
    itemId,
    observedQuantity,
    evidence: Object.freeze(evidence),
  });
}

export function intakeStoreEvent(input, workflowValue) {
  const workflow = readAgentWorkflowState(workflowValue);
  const event = validateStoreEvent(input);
  const prior = workflow.events.find((candidate) => candidate.eventId === event.eventId);
  if (prior) {
    // Compare by meaning: a stored (jsonb) event may list its keys in a different order.
    if (canonicalJson(prior) !== canonicalJson(event)) throw new Error('eventId already exists with conflicting event data.');
    return { workflow, event: prior, duplicate: true };
  }
  return {
    workflow: { ...workflow, events: [...workflow.events, event] },
    event,
    duplicate: false,
  };
}
