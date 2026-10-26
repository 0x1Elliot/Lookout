import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDemoHandler } from '../server.mjs';
import { addInventoryItem, createEmptyInventoryState, restockInventoryItem } from '../inventory.js';

export function apiFixtures() {
  const prefix = `api-${randomUUID()}`;
  const inventory = addInventoryItem(createEmptyInventoryState(), { name: 'Synthetic API notebooks', count: 8, location: 'API test room' });
  const timestamp = new Date().toISOString();
  const event = { eventId: prefix, occurredAt: timestamp, source: 'synthetic/direct-api-test', type: 'inventory-count-observed', itemId: inventory.inventoryItems[0].id, observedQuantity: 5,
    evidence: [{ id: `${prefix}-sheet`, kind: 'manual-count-sheet', description: 'Synthetic API fixture: five units; no real sensor observation.', observedAt: timestamp, observedQuantity: 5 }] };
  const caseId = `case:${event.eventId}`;
  const decision = { decisionId: `${prefix}-decision`, reviewerId: 'self-reported-test-reviewer', reviewerName: 'API test reviewer', outcome: 'approve', rationale: 'Synthetic API test decision.' };
  const unknownEvent = { ...event, eventId: `${prefix}-unknown`, observedQuantity: null, evidence: [{ ...event.evidence[0], observedQuantity: null }] };
  return {
    'intake': { stage: 'intake', event },
    'reconcile': { stage: 'reconcile', eventId: event.eventId, inventory },
    'review': { stage: 'review', caseId, decision },
    'unsupported-outcome': { stage: 'review', caseId, decision: { ...decision, outcome: 'auto-approve' } },
    'action': { stage: 'action', caseId, request: { actionRequestId: `${prefix}-action` }, inventory },
    'stale-action': { stage: 'action', caseId, request: { actionRequestId: `${prefix}-stale` }, inventory: restockInventoryItem(inventory, event.itemId, 1) },
    'new-action': { stage: 'action', caseId, request: { actionRequestId: `${prefix}-second` }, inventory },
    'forged-action': { stage: 'action', caseId: `${caseId}-forged`, request: { actionRequestId: `${prefix}-forged` }, inventory },
    'unknown-intake': { stage: 'intake', event: unknownEvent },
    'unknown-reconcile': { stage: 'reconcile', eventId: unknownEvent.eventId, inventory },
    'unsupported-approval': { stage: 'review', caseId: `case:${unknownEvent.eventId}`, decision: { ...decision, decisionId: `${prefix}-unknown-review` } },
    'reject': { stage: 'review', caseId, decision: { ...decision, outcome: 'reject' } },
  };
}
export function inProcessTransport(handler = createDemoHandler()) {
  return async (input, { raw, method = 'POST', contentType = 'application/json' } = {}) => {
    const request = Readable.from([raw ?? JSON.stringify(input)]);
    Object.assign(request, { method, url: '/api/agent/workflow', headers: contentType ? { 'content-type': contentType } : {} });
    let status, body;
    await handler(request, { writeHead(code) { status = code; }, end(value) { body = value; } });
    return { status, body: JSON.parse(body) };
  };
}
export async function runApiChecks(send, log = () => {}) {
  const f = apiFixtures();
  async function check(name, input, expected, options) {
    const result = await send(input, options); assert.equal(result.status, expected, `${name}: ${JSON.stringify(result.body)}`);
    log(`${expected} ${name}`); return result.body;
  }
  await check('malformed JSON', null, 400, { raw: '{' });
  await check('unsupported media type', {}, 415, { contentType: 'text/plain' });
  await check('unsupported method', {}, 405, { method: 'DELETE' });
  await check('invalid stage', { stage: 'magic' }, 400);
  await check('forged case cannot authorize action', f['forged-action'], 400);
  await check('valid intake', f.intake, 200);
  await check('valid reconciliation', f.reconcile, 200);
  await check('unapproved action blocked', f.action, 403);
  await check('unsupported review outcome', f['unsupported-outcome'], 400);
  await check('unknown count intake', f['unknown-intake'], 200);
  await check('unknown count reconciliation', f['unknown-reconcile'], 200);
  await check('approval without supported evidence-backed action', f['unsupported-approval'], 400);
  await check('self-reported human approval accepted (no authentication)', f.review, 200);
  await check('stale revision blocked', f['stale-action'], 409);
  const action = await check('valid action', f.action, 200);
  assert.equal(action.inventory.inventoryItems[0].quantityOnHand, 5);
  assert.equal(action.context.recentActivity[0].actionRequestId, f.action.request.actionRequestId);
  const duplicate = await check('same action retry is idempotent', f.action, 200);
  assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.inventory, action.inventory);
  await check('new action on completed case blocked', f['new-action'], 409);
  const rejected = apiFixtures();
  await check('rejection scenario intake', rejected.intake, 200);
  await check('rejection scenario reconciliation', rejected.reconcile, 200);
  await check('human rejection', rejected.reject, 200);
  await check('rejected action blocked', rejected.action, 403);
  return action;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === '--fixtures') {
    const directory = resolve(process.argv[3] ?? 'work/api-fixtures');
    await mkdir(directory, { recursive: true });
    for (const [name, value] of Object.entries(apiFixtures())) await writeFile(`${directory}/${name}.json`, JSON.stringify(value, null, 2));
    console.log(`Synthetic curl fixtures written to ${directory}`);
  } else {
    const urlIndex = process.argv.indexOf('--url');
    let send = inProcessTransport();
    if (urlIndex >= 0) {
      const base = new URL(process.argv[urlIndex + 1]);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Direct API tests are restricted to localhost.');
      send = async (input, { raw, method = 'POST', contentType = 'application/json' } = {}) => {
        const response = await fetch(new URL('/api/agent/workflow', base), { method, headers: { 'Content-Type': contentType }, body: raw ?? JSON.stringify(input) });
        return { status: response.status, body: await response.json() };
      };
    }
    await runApiChecks(send, console.log);
    console.log('All direct API checks passed. Synthetic snapshots only; browser inventory unchanged.');
  }
}
