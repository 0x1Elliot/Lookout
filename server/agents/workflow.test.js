import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  addInventoryItem,
  createEmptyInventoryState,
  normalizeInventoryState,
  restockInventoryItem,
} from '../../inventory.js';
import { createAgentInventoryContext } from '../agent-context.js';
import { createDemoHandler } from '../../server.mjs';
import { createAgentWorkflowService } from './workflow.js';
import { intakeStoreEvent } from './event-intake.js';
import { createAgentWorkflowState } from './contracts.js';

let id = 0;
const idFactory = () => `workflow-test-${++id}`;
const now = () => '2026-10-25T15:00:00.000Z';

function inventory(count = 8) {
  let next = 0;
  return addInventoryItem(createEmptyInventoryState(), {
    name: 'Blue notebooks', count, location: 'Back room A',
  }, { idFactory: () => `item-state-${++next}`, now });
}

function event(overrides = {}) {
  return {
    eventId: 'event-1',
    occurredAt: '2026-10-25T14:55:00.000Z',
    source: 'test/manual-cycle-count',
    type: 'inventory-count-observed',
    itemId: 'item-state-2',
    observedQuantity: 5,
    evidence: [{ id: 'evidence-1', kind: 'manual-count-sheet', description: 'A witnessed physical count recorded five units.', observedAt: '2026-10-25T14:55:00.000Z', observedQuantity: 5 }],
    ...overrides,
  };
}

function approve(service, caseRecord) {
  return service.review(caseRecord.caseId, {
    decisionId: `decision-${caseRecord.caseId}`,
    reviewerId: 'reviewer-1',
    reviewerName: 'Human reviewer',
    outcome: 'approve',
    rationale: 'I verified the supplied count evidence.',
    decidedAt: now(),
  });
}

test('event intake validates and preserves identifiers, timestamps, source, evidence, and unknowns', () => {
  const service = createAgentWorkflowService();
  const input = event({ observedQuantity: null, itemId: null, evidence: [{ ...event().evidence[0], observedQuantity: null }] });
  const result = service.intake(input);
  assert.equal(result.event.eventId, input.eventId);
  assert.equal(result.event.occurredAt, input.occurredAt);
  assert.equal(result.event.source, input.source);
  assert.equal(result.event.observedQuantity, null);
  assert.deepEqual(result.event.evidence, input.evidence);
  result.event.evidence[0].description = 'caller mutation';
  assert.notEqual(service.getState().events[0].evidence[0].description, 'caller mutation');
  assert.throws(() => service.intake({ ...input, source: 'conflicting-source' }), /conflicting event data/);
  assert.equal(service.intake(input).duplicate, true);
});

test('event intake rejects invalid timestamps, quantities, missing or conflicting evidence, and malformed contracts', () => {
  for (const invalid of [
    { ...event(), occurredAt: 'not-a-date' },
    { ...event(), observedQuantity: -1 },
    { ...event(), observedQuantity: 6 },
    { ...event(), evidence: [
      { ...event().evidence[0], id: 'count-a', observedQuantity: 5 },
      { ...event().evidence[0], id: 'count-b', observedQuantity: 4 },
    ] },
    { ...event(), observedQuantity: null },
    { ...event(), evidence: [] },
    { ...event(), evidence: [{ ...event().evidence[0], id: '' }] },
    { ...event(), evidence: [{ ...event().evidence[0], id: 'same' }, { ...event().evidence[0], id: 'same' }] },
    { ...event(), type: 'theft-detected' },
  ]) assert.throws(() => createAgentWorkflowService().intake(invalid));
});

test('reconciliation distinguishes matching counts, missing information, and evidence-backed variance', () => {
  const matching = createAgentWorkflowService();
  matching.intake(event({ observedQuantity: 8, evidence: [{ ...event().evidence[0], observedQuantity: 8 }] }));
  const equal = matching.reconcile('event-1', inventory());
  assert.equal(equal.caseRecord.status, 'no-action');
  assert.equal(equal.caseRecord.reviewRequired, false);
  assert.equal(equal.caseRecord.proposedAction, null);

  const unknown = createAgentWorkflowService();
  unknown.intake(event({ observedQuantity: null, evidence: [{ ...event().evidence[0], observedQuantity: null }] }));
  const unknownResult = unknown.reconcile('event-1', inventory());
  assert.equal(unknownResult.caseRecord.status, 'needs-information');
  assert.equal(unknownResult.caseRecord.proposedAction, null);
  assert.ok(unknownResult.caseRecord.unknowns.length > 0);

  const discrepancy = createAgentWorkflowService();
  discrepancy.intake(event());
  const result = discrepancy.reconcile('event-1', inventory());
  assert.equal(result.caseRecord.discrepancyType, 'count-variance');
  assert.equal(result.caseRecord.proposedAction.targetQuantity, 5);
  assert.match(result.caseRecord.unknowns.join(' '), /cause.*unknown/i);
  assert.equal(discrepancy.reconcile('event-1', inventory()).duplicate, true);
});

test('review coordination records human decisions and will not approve cases without a supported discrepancy action', () => {
  const service = createAgentWorkflowService();
  service.intake(event({ observedQuantity: null, evidence: [{ ...event().evidence[0], observedQuantity: null }] }));
  const result = service.reconcile('event-1', inventory());
  assert.throws(() => service.review(result.caseRecord.caseId, {
    decisionId: 'decision', reviewerId: 'reviewer', reviewerName: 'Reviewer', outcome: 'approve', rationale: 'Looks fine',
  }), /no evidence-backed action/);

  const missingInfo = createAgentWorkflowService();
  missingInfo.intake(event({ itemId: null, observedQuantity: null, evidence: [{ ...event().evidence[0], observedQuantity: null }] }));
  const unknownCase = missingInfo.reconcile('event-1', inventory()).caseRecord;
  const moreInfo = missingInfo.review(unknownCase.caseId, {
    decisionId: 'need-info', reviewerId: 'reviewer', reviewerName: 'Reviewer',
    outcome: 'request-more-information', rationale: 'Identify the item and submit a verified count.',
  });
  assert.equal(moreInfo.caseRecord.status, 'needs-information');

  const needsReview = createAgentWorkflowService();
  needsReview.intake(event());
  const discrepancy = needsReview.reconcile('event-1', inventory()).caseRecord;
  const reviewed = approve(needsReview, discrepancy);
  assert.equal(reviewed.caseRecord.review.outcome, 'approve');
  assert.equal(needsReview.review(discrepancy.caseId, reviewed.caseRecord.review.input).duplicate, true);
  assert.throws(() => needsReview.review(discrepancy.caseId, {
    decisionId: 'different', reviewerId: 'reviewer-2', reviewerName: 'Second', outcome: 'reject', rationale: 'Different',
  }), /final reviewer decision/);
});

test('review coordination records a request for information and a later human decision in history', () => {
  const service = createAgentWorkflowService();
  service.intake(event());
  const record = service.reconcile('event-1', inventory()).caseRecord;
  const requested = service.review(record.caseId, {
    decisionId: 'decision-info', reviewerId: 'reviewer-1', reviewerName: 'Reviewer',
    outcome: 'request-more-information', rationale: 'Please attach a second count sheet.',
  });
  const approved = service.review(record.caseId, {
    decisionId: 'decision-final', reviewerId: 'reviewer-1', reviewerName: 'Reviewer',
    outcome: 'approve', rationale: 'I reviewed the count evidence.',
  });
  assert.equal(requested.caseRecord.reviewHistory.length, 1);
  assert.equal(approved.caseRecord.reviewHistory.length, 2);
  assert.equal(approved.caseRecord.status, 'approved');
});

test('a rejected review remains auditable and cannot authorize inventory action', () => {
  const service = createAgentWorkflowService();
  service.intake(event());
  const record = service.reconcile('event-1', inventory()).caseRecord;
  const rejected = service.review(record.caseId, {
    decisionId: 'decision-reject', reviewerId: 'reviewer-1', reviewerName: 'Reviewer',
    outcome: 'reject', rationale: 'The evidence does not justify a count change.',
  });
  assert.equal(rejected.caseRecord.status, 'rejected');
  assert.equal(rejected.caseRecord.reviewHistory[0].outcome, 'reject');
  assert.throws(() => service.act(record.caseId, { actionRequestId: 'action-rejected' }, inventory()), /unapproved/);
});

test('inventory action rejects unapproved cases and malformed action contracts', () => {
  const service = createAgentWorkflowService();
  service.intake(event());
  const record = service.reconcile('event-1', inventory()).caseRecord;
  assert.throws(() => service.act(record.caseId, { actionRequestId: 'action-1' }, inventory()), /unapproved/);
  approve(service, record);
  assert.throws(() => service.act(record.caseId, {}, inventory()), /actionRequestId/);
});

test('inventory action rejects stale counts and changed inventory revisions', () => {
  const service = createAgentWorkflowService();
  service.intake(event());
  const initial = inventory();
  const record = service.reconcile('event-1', initial).caseRecord;
  approve(service, record);
  const changed = restockInventoryItem(initial, initial.inventoryItems[0].id, 1, { idFactory, now });
  assert.throws(() => service.act(record.caseId, { actionRequestId: 'action-1' }, changed), /changed since reconciliation/);
});

test('end-to-end workflow requires human review, executes a verified count once, and exposes audit history to context reads', () => {
  const service = createAgentWorkflowService({ idFactory, now });
  const initial = inventory();
  const intake = service.intake(event());
  assert.equal(intake.duplicate, false);
  const reconciliation = service.reconcile(intake.event.eventId, initial);
  assert.equal(reconciliation.caseRecord.status, 'awaiting-review');
  assert.throws(() => service.act(reconciliation.caseRecord.caseId, { actionRequestId: 'too-early' }, initial), /unapproved/);
  const review = approve(service, reconciliation.caseRecord);
  const result = service.act(review.caseRecord.caseId, { actionRequestId: 'action-1' }, initial);
  assert.equal(result.inventory.inventoryItems[0].quantityOnHand, 5);
  assert.equal(result.inventory.activity[0].type, 'inventory-count-adjusted');
  assert.equal(normalizeInventoryState(result.inventory), result.inventory);
  const context = createAgentInventoryContext(result.inventory);
  assert.equal(context.items[0].quantityOnHand, 5);
  assert.equal(context.recentActivity[0].eventId, 'event-1');
  assert.equal(context.recentActivity[0].actionRequestId, 'action-1');
  assert.deepEqual(context.recentActivity[0].evidenceIds, ['evidence-1']);

  const retry = service.act(review.caseRecord.caseId, { actionRequestId: 'action-1' }, initial);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.inventory.inventoryItems[0].quantityOnHand, 5);
  assert.equal(retry.inventory.activity.length, result.inventory.activity.length);
  assert.throws(() => service.act(review.caseRecord.caseId, { actionRequestId: 'action-2' }, result.inventory), /already been executed/);
});

test('rejects unknown events and unsupported workflow state instead of inventing agent outputs', () => {
  const service = createAgentWorkflowService();
  assert.throws(() => service.reconcile('missing', inventory()), /Validated event was not found/);
  assert.throws(() => createAgentWorkflowService().intake(event({ observedQuantity: 'five' })), /non-negative whole number or null/);
});

function requestHandler(handler, stage, payload, path = '/api/agent/workflow', method = 'POST') {
  const request = Readable.from([JSON.stringify(payload)]);
  request.method = method;
  request.url = path;
  request.headers = { 'content-type': 'application/json' };
  const output = { chunks: [] };
  const response = {
    writeHead(statusCode, headers = {}) { output.statusCode = statusCode; output.headers = headers; },
    end(body = '') { output.chunks.push(String(body)); },
  };
  return handler(request, response).then(() => ({ ...output, body: JSON.parse(output.chunks.join('')) }));
}

test('workflow API connects all four responsibilities without a listening port and context reads see the result', async () => {
  const handler = createDemoHandler();
  const initial = inventory();
  const intake = await requestHandler(handler, 'intake', { stage: 'intake', event: event() });
  assert.equal(intake.statusCode, 200);
  const reconciliation = await requestHandler(handler, 'reconcile', {
    stage: 'reconcile', eventId: 'event-1', inventory: initial,
  });
  assert.equal(reconciliation.body.caseRecord.status, 'awaiting-review');
  const review = await requestHandler(handler, 'review', {
    stage: 'review', caseId: reconciliation.body.caseRecord.caseId,
    decision: { decisionId: 'http-decision', reviewerId: 'reviewer', reviewerName: 'Human reviewer', outcome: 'approve', rationale: 'Evidence checked.' },
  });
  assert.equal(review.body.caseRecord.status, 'approved');
  const action = await requestHandler(handler, 'action', {
    stage: 'action', caseId: review.body.caseRecord.caseId,
    request: { actionRequestId: 'http-action' }, inventory: initial,
  });
  assert.equal(action.statusCode, 200);
  assert.equal(action.body.inventory.inventoryItems[0].quantityOnHand, 5);
  assert.equal(action.body.context.recentActivity[0].actionRequestId, 'http-action');

  const context = await requestHandler(handler, 'context', action.body.inventory, '/api/agent/context');
  assert.equal(context.statusCode, 200);
  assert.equal(context.body.items[0].quantityOnHand, 5);
  const ledger = await requestHandler(handler, 'ledger', {}, '/api/agent/workflow', 'GET');
  assert.equal(ledger.statusCode, 200);
  assert.equal(ledger.body.workflow.cases[0].status, 'completed');
});

test('workflow API rejects action attempts without an approved server-side case', async () => {
  const handler = createDemoHandler();
  const result = await requestHandler(handler, 'action', {
    stage: 'action', caseId: 'case:forged', request: { actionRequestId: 'forged-action' }, inventory: inventory(),
  });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /case was not found/);
});

// ---- Event-level idempotency: duplicates are compared by meaning, not by key order ----

const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]))
    : value;
// PostgreSQL jsonb returns object keys ordered by length, then bytewise. Reproduce that here
// so the unit tests exercise the same shape a stored event has after a database round trip.
const jsonbOrder = (value) => Array.isArray(value) ? value.map(jsonbOrder)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map((key) => [key, jsonbOrder(value[key])]))
    : value;
const stateWith = (...events) => ({ ...createAgentWorkflowState(), events });

test('event intake treats the same event as a duplicate regardless of object key order, including nested evidence', () => {
  const original = event();
  assert.notDeepEqual(Object.keys(reverseKeys(original)), Object.keys(original), 'sanity: the reordered copy really lists keys differently');
  assert.notDeepEqual(Object.keys(reverseKeys(original).evidence[0]), Object.keys(original.evidence[0]));
  for (const [label, stored, submitted] of [
    ['reversed keys submitted after original order', original, reverseKeys(original)],
    ['original order submitted after reversed keys', reverseKeys(original), original],
    ['jsonb-ordered stored document, original-order resubmission', jsonbOrder(original), original],
    ['jsonb-ordered stored document, reversed resubmission', jsonbOrder(original), reverseKeys(original)],
  ]) {
    const result = intakeStoreEvent(submitted, stateWith(stored));
    assert.equal(result.duplicate, true, label);
    assert.equal(result.workflow.events.length, 1, label);
    assert.strictEqual(result.event, stored, `${label}: the already-stored event is returned unchanged`);
  }
});

test('event intake treats a repeated event ID with any meaningful difference as a conflict', () => {
  const base = event();
  const evidence = base.evidence[0];
  const twoEvidence = event({ evidence: [evidence, { ...evidence, id: 'evidence-2', description: 'A second sheet.' }] });
  const cases = [
    ['different quantity (evidence kept consistent)', event({ observedQuantity: 6, evidence: [{ ...evidence, observedQuantity: 6 }] })],
    ['different source', event({ source: 'test/another-source' })],
    ['different itemId', event({ itemId: 'item-state-9' })],
    ['itemId removed', event({ itemId: null })],
    ['different occurredAt', event({ occurredAt: '2026-10-25T14:56:00.000Z' })],
    ['different evidence id', event({ evidence: [{ ...evidence, id: 'evidence-9' }] })],
    ['different evidence kind', event({ evidence: [{ ...evidence, kind: 'photo' }] })],
    ['different evidence description', event({ evidence: [{ ...evidence, description: 'Changed text.' }] })],
    ['different evidence observedAt', event({ evidence: [{ ...evidence, observedAt: '2026-10-25T14:56:00.000Z' }] })],
    ['extra evidence record', twoEvidence],
  ];
  for (const [label, changed] of cases) {
    for (const stored of [base, jsonbOrder(base)]) {
      assert.throws(() => intakeStoreEvent(changed, stateWith(stored)), /conflicting event data/, label);
      assert.throws(() => intakeStoreEvent(reverseKeys(changed), stateWith(stored)), /conflicting event data/, `${label} (reordered keys)`);
    }
  }
  // Array order is preserved: the same evidence in a different order is a different submission.
  assert.equal(intakeStoreEvent(twoEvidence, stateWith(jsonbOrder(twoEvidence))).duplicate, true);
  const swapped = { ...twoEvidence, evidence: [...twoEvidence.evidence].reverse() };
  assert.throws(() => intakeStoreEvent(swapped, stateWith(jsonbOrder(twoEvidence))), /conflicting event data/);
});

test('a conflicting repeat does not alter the stored event or the workflow state', () => {
  const service = createAgentWorkflowService();
  service.intake(event());
  const before = service.getState();
  assert.throws(() => service.intake(event({ source: 'test/another-source' })), /conflicting event data/);
  assert.deepEqual(service.getState(), before);
  assert.equal(service.intake(reverseKeys(event())).duplicate, true);
  assert.deepEqual(service.getState(), before);
});
