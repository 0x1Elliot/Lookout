import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addInventoryItem,
  beginRestock,
  createEmptyInventoryState,
  normalizeInventoryState,
  reconcileTask,
} from './inventory.js';

function makeIdFactory() {
  let number = 0;
  return () => `test-id-${++number}`;
}

function makeState(count = 12) {
  return addInventoryItem(createEmptyInventoryState(), {
    name: 'Test item',
    count,
    location: 'Back room A',
  }, {
    idFactory: makeIdFactory(),
    now: () => '2026-10-20T12:00:00.000Z',
  });
}

test('creates an inventory item, reuses a matching location, and records the addition', () => {
  let state = createEmptyInventoryState();
  const idFactory = makeIdFactory();
  state = addInventoryItem(state, { name: ' Pens ', count: '8', location: 'Shelf A' }, { idFactory });
  state = addInventoryItem(state, { name: 'Pencils', count: '4', location: ' shelf a ' }, { idFactory });

  assert.equal(state.schemaVersion, 2);
  assert.equal(state.locations.length, 1);
  assert.equal(state.inventoryItems.length, 2);
  assert.equal(state.inventoryItems[0].name, 'Pens');
  assert.equal(state.inventoryItems[0].quantityOnHand, 8);
  assert.equal(state.inventoryItems[0].locationId, state.inventoryItems[1].locationId);
  assert.equal(state.activity.length, 2);
  assert.equal(state.activity[0].type, 'inventory-item-added');
  assert.equal(state.activity[0].quantityRemaining, 4);
});

test('rejects invalid item names, locations, and recorded quantities', () => {
  const state = createEmptyInventoryState();
  assert.throws(() => addInventoryItem(state, { name: '', count: '1', location: 'Shelf A' }), /item name/);
  assert.throws(() => addInventoryItem(state, { name: 'Pens', count: '1', location: '' }), /where the item is stored/);
  assert.throws(() => addInventoryItem(state, { name: 'Pens', count: '-1', location: 'Shelf A' }), /whole number/);
  assert.throws(() => addInventoryItem(state, { name: 'Pens', count: '1.5', location: 'Shelf A' }), /whole number/);
  assert.throws(() => addInventoryItem(state, { name: 'Pens', count: '0x10', location: 'Shelf A' }), /whole number/);
});

test('starting a restock deducts units immediately and records a pending task and activity', () => {
  const original = makeState();
  const itemId = original.inventoryItems[0].id;
  const updated = beginRestock(original, itemId, '5', {
    idFactory: makeIdFactory(),
    now: () => '2026-10-20T12:05:00.000Z',
  });

  assert.equal(original.inventoryItems[0].quantityOnHand, 12);
  assert.equal(updated.inventoryItems[0].quantityOnHand, 7);
  assert.equal(updated.restockTasks[0].quantityBefore, 12);
  assert.equal(updated.restockTasks[0].quantityAfter, 7);
  assert.equal(updated.restockTasks[0].status, 'pending');
  assert.equal(updated.activity[0].type, 'restock-started');
  assert.equal(updated.activity[0].quantityRemaining, 7);
});

test('rejects a missing item, a non-positive quantity, and a quantity above available stock', () => {
  const state = makeState();
  assert.throws(() => beginRestock(state, 'missing-item', 1), /Choose an inventory item/);
  assert.throws(() => beginRestock(state, state.inventoryItems[0].id, '0'), /positive whole number/);
  assert.throws(() => beginRestock(state, state.inventoryItems[0].id, '13'), /Only 12 units are available at Back room A/);
});

test('Returned restores the units and Shelf restocked keeps the immediate deduction', () => {
  const initial = makeState();
  const itemId = initial.inventoryItems[0].id;
  const started = beginRestock(initial, itemId, 4, { idFactory: makeIdFactory() });
  const taskId = started.restockTasks[0].id;

  const returned = reconcileTask(started, taskId, 'returned', { idFactory: makeIdFactory() });
  assert.equal(returned.inventoryItems[0].quantityOnHand, 12);
  assert.equal(returned.restockTasks[0].status, 'returned');
  assert.equal(returned.activity[0].type, 'returned');
  assert.equal(returned.activity[0].quantityRemaining, 12);

  const restocked = reconcileTask(started, taskId, 'shelf-restocked', { idFactory: makeIdFactory() });
  assert.equal(restocked.inventoryItems[0].quantityOnHand, 8);
  assert.equal(restocked.restockTasks[0].status, 'shelf-restocked');
  assert.equal(restocked.activity[0].type, 'shelf-restocked');
});

test('prevents a completed task from being reconciled twice and rejects unknown outcomes', () => {
  const initial = makeState();
  const started = beginRestock(initial, initial.inventoryItems[0].id, 4, { idFactory: makeIdFactory() });
  const taskId = started.restockTasks[0].id;
  const returned = reconcileTask(started, taskId, 'returned');
  assert.throws(() => reconcileTask(returned, taskId, 'returned'), /already complete/);
  assert.throws(() => reconcileTask(started, taskId, 'lost'), /Choose Returned or Shelf restocked/);
  assert.throws(() => reconcileTask(started, 'missing-task', 'returned'), /could not be found/);
});

test('migrates Phase 1 browser data into locations, quantities, tasks, and activity', () => {
  const legacy = {
    items: [
      { id: 'item-1', name: 'Blue notebooks', count: 7, location: 'Back room A' },
      { id: 'item-2', name: 'Red notebooks', count: 4, location: ' back room a ' },
    ],
    tasks: [
      { id: 'task-1', itemId: 'item-1', itemName: 'Blue notebooks', location: 'Back room A', quantity: 5, remaining: 7, status: 'pending', createdAt: '2026-10-20T12:00:00.000Z' },
      { id: 'task-2', itemId: 'item-1', itemName: 'Blue notebooks', location: 'Back room A', quantity: 2, remaining: 8, status: 'returned', createdAt: '2026-10-20T11:00:00.000Z', completedAt: '2026-10-20T11:10:00.000Z' },
    ],
  };
  const migrated = normalizeInventoryState(legacy, { idFactory: makeIdFactory() });

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.locations.length, 1);
  assert.equal(migrated.inventoryItems[0].quantityOnHand, 7);
  assert.equal(migrated.inventoryItems[1].quantityOnHand, 4);
  assert.equal(migrated.restockTasks[0].status, 'pending');
  assert.equal(migrated.restockTasks[1].status, 'returned');
  assert.deepEqual(migrated.activity.map((entry) => entry.type), ['restock-started', 'returned', 'restock-started']);
  assert.deepEqual(legacy.items[0], { id: 'item-1', name: 'Blue notebooks', count: 7, location: 'Back room A' });
});

test('rejects unsupported or incomplete saved state instead of silently discarding it', () => {
  assert.deepEqual(normalizeInventoryState(null), createEmptyInventoryState());
  assert.throws(() => normalizeInventoryState({ schemaVersion: 2, inventoryItems: [] }), /incomplete/);
  assert.throws(() => normalizeInventoryState({ somethingElse: [] }), /unsupported format/);
  const validState = makeState();
  assert.equal(normalizeInventoryState(validState), validState);
  assert.throws(() => normalizeInventoryState({ ...validState, inventoryItems: [{ ...validState.inventoryItems[0], locationId: 'missing' }] }), /invalid item or location reference/);
});
