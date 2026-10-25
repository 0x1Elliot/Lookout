import test from 'node:test';
import assert from 'node:assert/strict';
import { addInventoryItem, beginRestock, createEmptyInventoryState, reconcileTask } from '../inventory.js';
import { createAgentInventoryContext } from './agent-context.js';

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
  }));

  const context = createAgentInventoryContext(state);
  assert.equal(context.recentActivity.length, 20);
  assert.equal(context.recentActivity[0].itemName, 'Item 0');
});
