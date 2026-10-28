import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptWorkflowResponse, FIELD_ASSUMPTIONS } from './dashboard-adapter.js';

const event = (eventId, extra = {}) => ({ eventId, occurredAt: '2026-10-27T10:00:00.000Z', source: 'synthetic/test', type: 'inventory-count-observed', itemId: 'item-1', observedQuantity: 5, evidence: [], ...extra });
const record = (eventId, extra = {}) => ({ caseId: `case:${eventId}`, eventId, stage: 'reconciled', status: 'awaiting-review', discrepancy: true, discrepancyType: 'count-variance',
  unknowns: ['The cause of the count variance is unknown.'], proposedAction: { type: 'set-verified-count', itemId: 'item-1', expectedQuantity: 8, targetQuantity: 5 },
  review: null, reviewHistory: [], action: null, ...extra });
const inventory = (activity = []) => ({ schemaVersion: 2, inventoryItems: [{ id: 'item-1', name: 'Notebooks', quantityOnHand: 8 }], activity });
const response = (workflow, inv) => ({ workflow: { version: 1, events: [], cases: [], actions: [], ...workflow }, ...(inv ? { inventory: inv } : {}) });
const agent = (model, id) => model.agents.find((entry) => entry.id === id);
const card = (model, id) => model.overview.find((entry) => entry.id === id);

test('an empty workflow reports "No data" for every agent and never an idle or processing status', () => {
  const model = adaptWorkflowResponse(response({}));
  assert.equal(model.agents.length, 4);
  assert.deepEqual(model.agents.map((entry) => entry.name), ['Detection', 'Reconciliation', 'Review Coordination', 'Inventory Action']);
  for (const entry of model.agents) {
    assert.equal(entry.status.label, 'No data');
    assert.doesNotMatch(JSON.stringify(entry.status), /idle|processing|working/i);
  }
  assert.deepEqual(model.overview.map((entry) => entry.value), [0, 0, 0, 0]);
  assert.deepEqual(model.attention, []);
  assert.deepEqual(model.activity, []);
});

test('counts and attention come only from recorded cases, with each state kept distinct', () => {
  const model = adaptWorkflowResponse(response({
    events: [event('e1'), event('e2'), event('e3'), event('e4'), event('e5'), event('e6')],
    cases: [
      record('e1'),
      record('e2', { status: 'needs-information', discrepancy: false, discrepancyType: null, proposedAction: null, unknowns: ['The physical count is unknown.'] }),
      record('e3', { status: 'approved', review: { outcome: 'approve', decidedAt: '2026-10-27T10:30:00.000Z' }, reviewHistory: [{ outcome: 'approve', decidedAt: '2026-10-27T10:30:00.000Z' }] }),
      record('e4', { status: 'completed' }),
      record('e5', { status: 'rejected', review: { outcome: 'reject', decidedAt: '2026-10-27T10:20:00.000Z' } }),
    ],
    actions: [{ actionRequestId: 'a1', caseId: 'case:e4', itemId: 'item-1', quantityOnHand: 5, completedAt: '2026-10-27T11:00:00.000Z', status: 'completed' }],
  }, inventory()));
  assert.equal(card(model, 'validated').value, 6);
  assert.equal(card(model, 'completed').value, 2);
  assert.match(card(model, 'completed').detail, /1 applied/);
  assert.match(card(model, 'completed').detail, /1 rejected/);
  // e6 has no case yet: in progress, but not a problem.
  assert.equal(card(model, 'in-progress').value, 4);
  assert.equal(card(model, 'attention').value, 3);
  assert.deepEqual(model.attention.map((item) => item.eventId), ['e1', 'e2', 'e3']);
  assert.ok(model.attention.every((item) => item.demo === false));
  assert.match(model.attention[0].detail, /Recorded 8, observed 5/);
  assert.match(model.attention[0].nextAction, /Inventory has not changed/);
  assert.equal(model.attention[1].issue, 'Required event information is missing');
});

test('agent statuses are derived from case records only', () => {
  const model = adaptWorkflowResponse(response({
    events: [event('e1'), event('e2')],
    cases: [record('e1', { status: 'approved', review: { outcome: 'approve', decidedAt: '2026-10-27T10:30:00.000Z' } })],
  }));
  assert.equal(agent(model, 'detection').status.label, '2 events validated');
  assert.equal(agent(model, 'detection').status.detail, '1 not yet reconciled');
  assert.equal(agent(model, 'reconciliation').status.label, '1 case recorded');
  assert.equal(agent(model, 'review').status.label, '1 decision recorded');
  assert.equal(agent(model, 'action').status.label, '1 approved, not yet applied');
  assert.equal(agent(model, 'action').status.tone, 'attention');
  assert.equal(card(model, 'attention').value, 1);
  assert.match(model.attention[0].nextAction, /authorized worker applies/);
});

test('a reviewer request for more information stays unresolved and is never reported as resolved', () => {
  const model = adaptWorkflowResponse(response({
    events: [event('e1')],
    cases: [record('e1', { status: 'needs-information', review: { outcome: 'request-more-information', decidedAt: '2026-10-27T10:30:00.000Z' } })],
  }));
  assert.equal(model.attention[0].issue, 'More information requested by a reviewer');
  assert.doesNotMatch(JSON.stringify(model.attention), /resolved|corrected/i);
});

test('an unmatched item and an unrecognized status both surface for attention instead of being hidden', () => {
  const model = adaptWorkflowResponse(response({
    events: [event('e1', { itemId: 'missing' }), event('e2')],
    cases: [record('e1', { discrepancyType: 'unmatched-inventory-item', proposedAction: null, unknowns: ['The referenced item is not present in the supplied inventory snapshot.'] }),
      record('e2', { status: 'mystery-state' })],
  }, inventory()));
  assert.equal(model.attention[0].issue, 'Event refers to an item that is not in inventory');
  assert.equal(model.attention[0].reference, 'missing');
  assert.equal(model.attention[1].issue, 'Processing outcome not recognized');
  assert.equal(model.attention[1].nextAction, null);
});

test('the feed is newest first, names items, and does not invent times or agents', () => {
  const model = adaptWorkflowResponse(response({
    events: [event('e1')],
    cases: [record('e1', { status: 'completed', review: { outcome: 'approve', decidedAt: '2026-10-27T10:30:00.000Z' }, reviewHistory: [{ outcome: 'approve', decidedAt: '2026-10-27T10:30:00.000Z' }] })],
    actions: [{ actionRequestId: 'a1', caseId: 'case:e1', itemId: 'item-1', quantityOnHand: 5, completedAt: '2026-10-27T11:00:00.000Z', status: 'completed' }],
  }, inventory([
    { id: 'act-2', type: 'inventory-count-adjusted', itemName: 'Notebooks', quantity: 5, createdAt: '2026-10-27T11:00:00.000Z', actionRequestId: 'a1' },
    { id: 'act-1', type: 'shelf-restocked', itemName: 'Notebooks', quantity: 2, createdAt: '2026-10-27T09:00:00.000Z' },
  ])));
  assert.deepEqual(model.activity.map((entry) => entry.eventType), [
    'Count applied to inventory', 'Review approved', 'Discrepancy detected', 'Count observed', 'Shelf restocked',
  ]);
  // The adjustment entry duplicates the action, so only one of them is listed.
  assert.equal(model.activity.filter((entry) => /applied|adjusted/i.test(entry.eventType)).length, 1);
  const reconciled = model.activity.find((entry) => entry.eventType === 'Discrepancy detected');
  assert.equal(reconciled.time, null);
  assert.equal(reconciled.reference, 'Notebooks');
  assert.equal(model.activity.find((entry) => entry.eventType === 'Shelf restocked').agent, 'Not recorded');
  assert.ok(model.activity.every((entry) => entry.demo === false));
});

test('the local demo server response has no inventory, which is reported rather than guessed', () => {
  const model = adaptWorkflowResponse(response({ events: [event('e1')] }));
  assert.equal(model.inventoryAvailable, false);
  assert.equal(model.activity[0].reference, 'item-1');
});

test('the feed is capped and a malformed response is rejected', () => {
  const many = Array.from({ length: 45 }, (_, index) => event(`e${index}`, { occurredAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString() }));
  const model = adaptWorkflowResponse(response({ events: many }));
  assert.equal(model.activity.length, 30);
  assert.equal(model.activity[0].id, 'event:e44');
  for (const bad of [null, {}, { workflow: null }, { workflow: { events: [], cases: [] } }, { workflow: { events: {}, cases: [], actions: [] } }]) {
    assert.throws(() => adaptWorkflowResponse(bad), /Unexpected workflow response/);
  }
});

test('statusCounts counts recorded cases only, by the code’s status names, and leaves other output unchanged', () => {
  const workflow = {
    events: [event('e1'), event('e2'), event('e3'), event('e4'), event('e5'), event('e6'), event('e7')],
    cases: [
      record('e1'), record('e2'),
      record('e3', { status: 'needs-information', discrepancy: false, discrepancyType: null, proposedAction: null }),
      record('e4', { status: 'completed' }), record('e5', { status: 'rejected' }),
      record('e6', { status: 'mystery-state' }),
    ],
  };
  const model = adaptWorkflowResponse(response(workflow));
  // e7 has no case, so it is not counted; order follows the workflow, with unrecognized last.
  assert.deepEqual(model.statusCounts, [
    { status: 'awaiting-review', count: 2 },
    { status: 'needs-information', count: 1 },
    { status: 'completed', count: 1 },
    { status: 'rejected', count: 1 },
    { status: 'unrecognized', count: 1 },
  ]);
  assert.equal(model.statusCounts.reduce((sum, entry) => sum + entry.count, 0), workflow.cases.length);
  assert.equal(card(model, 'validated').value, 7);
  assert.equal(card(model, 'in-progress').value, 5);
  assert.equal(model.attention.length, 4);
  assert.deepEqual(adaptWorkflowResponse(response({})).statusCounts, []);
  assert.ok(JSON.stringify(model.statusCounts).indexOf('demo') === -1);
});

test('field assumptions are listed for review', () => {
  assert.ok(FIELD_ASSUMPTIONS.length >= 8);
  assert.ok(FIELD_ASSUMPTIONS.every((line) => typeof line === 'string' && line.length > 20));
});
