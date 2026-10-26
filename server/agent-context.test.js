import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { addInventoryItem, beginRestock, createEmptyInventoryState, reconcileTask } from '../inventory.js';
import { createAgentInventoryContext } from './agent-context.js';
import { createDemoHandler } from '../server.mjs';

function sampleState() {
  let state = addInventoryItem(createEmptyInventoryState(), { name: 'Blue notebooks', count: 8, location: 'Back room A' });
  state = beginRestock(state, state.inventoryItems[0].id, 3);
  state = reconcileTask(state, state.restockTasks[0].id, 'shelf-restocked');
  return state;
}

test('creates a minimal agent context with stock, pending tasks, and recent activity', () => {
  const state = sampleState();
  const context = createAgentInventoryContext(state);

  assert.deepEqual(context.items, [{
    id: state.inventoryItems[0].id,
    name: 'Blue notebooks',
    location: 'Back room A',
    quantityOnHand: 5,
  }]);
  assert.deepEqual(context.pendingTasks, []);
  assert.deepEqual(context.recentActivity.map(({ type }) => type), ['shelf-restocked', 'restock-started', 'inventory-item-added']);
  assert.equal(JSON.stringify(context).includes('locationId'), false);
});

test('rejects incomplete inventory and invalid item references', () => {
  assert.throws(() => createAgentInventoryContext({ schemaVersion: 2 }), /incomplete or unsupported/);

  const state = sampleState();
  const invalid = { ...state, inventoryItems: [{ ...state.inventoryItems[0], locationId: 'missing' }] };
  assert.throws(() => createAgentInventoryContext(invalid), /invalid item/);
});

test('limits activity included in the context to the twenty most recent entries', () => {
  const state = sampleState();
  state.activity = Array.from({ length: 25 }, (_, index) => ({
    type: 'inventory-item-added', itemName: `Item ${index}`, locationName: 'Shelf A', quantity: index + 1,
    createdAt: '2026-10-20T12:00:00.000Z',
  }));

  const context = createAgentInventoryContext(state);
  assert.equal(context.recentActivity.length, 20);
  assert.equal(context.recentActivity[0].itemName, 'Item 0');
});

function invokeContextRoute({ method = 'POST', body = '', contentType = 'application/json' } = {}) {
  const request = Readable.from([body]);
  request.method = method;
  request.url = '/api/agent/context';
  request.headers = { 'content-type': contentType };
  const result = { headers: {}, chunks: [] };
  const response = {
    writeHead(statusCode, headers = {}) { result.statusCode = statusCode; result.headers = headers; return this; },
    end(chunk = '') { result.chunks.push(String(chunk)); },
  };
  return createDemoHandler()(request, response).then(() => ({
    ...result,
    body: result.chunks.join(''),
  }));
}

test('POST /api/agent/context returns the documented context shape without mutating input', async () => {
  const state = sampleState();
  const original = structuredClone(state);
  const result = await invokeContextRoute({ body: JSON.stringify(state) });

  assert.equal(result.statusCode, 200);
  assert.match(result.headers['content-type'], /application\/json/);
  assert.deepEqual(Object.keys(JSON.parse(result.body)), ['items', 'pendingTasks', 'recentActivity']);
  assert.deepEqual(state, original);
});

test('context route reports unsupported method, media type, malformed JSON, and invalid inventory', async () => {
  const method = await invokeContextRoute({ method: 'GET' });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, 'POST');

  const mediaType = await invokeContextRoute({ contentType: 'text/plain', body: '{}' });
  assert.equal(mediaType.statusCode, 415);
  assert.deepEqual(JSON.parse(mediaType.body), { error: 'Content-Type must be application/json.' });

  const malformed = await invokeContextRoute({ body: '{' });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(JSON.parse(malformed.body), { error: 'Invalid JSON.' });

  const invalid = await invokeContextRoute({ body: JSON.stringify({ schemaVersion: 2 }) });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(JSON.parse(invalid.body), { error: 'Invalid inventory context request.' });
});

test('context route rejects oversized requests with 413', async () => {
  const result = await invokeContextRoute({ body: ' '.repeat(1_000_001) });
  assert.equal(result.statusCode, 413);
  assert.deepEqual(JSON.parse(result.body), { error: 'Request body is too large.' });
});
