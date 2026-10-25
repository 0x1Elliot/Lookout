import test from 'node:test';
import assert from 'node:assert/strict';
import { addInventoryItem, beginRestock, createEmptyInventoryState, reconcileTask } from './inventory.js';
import {
  INVENTORY_BACKUP_KEY,
  INVENTORY_STORAGE_KEY,
  loadInventoryState,
  saveInventoryState,
} from './inventory-storage.js';

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function makeState() {
  let id = 0;
  const idFactory = () => `saved-${++id}`;
  const added = addInventoryItem(createEmptyInventoryState(), {
    name: 'Blue notebooks', count: 12, location: 'Back room A',
  }, { idFactory, now: () => '2026-10-20T12:00:00.000Z' });
  const started = beginRestock(added, added.inventoryItems[0].id, 4, {
    idFactory, now: () => '2026-10-20T12:05:00.000Z',
  });
  return reconcileTask(started, started.restockTasks[0].id, 'returned', {
    idFactory, now: () => '2026-10-20T12:10:00.000Z',
  });
}

test('saves and reloads existing browser records under the unchanged storage key', () => {
  const state = makeState();
  const storage = makeStorage();

  saveInventoryState(storage, state);
  const loaded = loadInventoryState(storage);

  assert.equal(INVENTORY_STORAGE_KEY, 'lookout.inventory.v1');
  assert.deepEqual(loaded, JSON.parse(JSON.stringify(state)));
  assert.equal(loaded.inventoryItems[0].quantityOnHand, 12);
  assert.deepEqual(loaded.restockTasks.map((task) => task.status), ['returned']);
  assert.deepEqual(loaded.activity.map((entry) => entry.type), ['returned', 'restock-started', 'inventory-item-added']);
  assert.equal(storage.getItem(INVENTORY_BACKUP_KEY), null);
});

test('backs up and migrates older saved browser records without dropping them', () => {
  const legacy = {
    items: [{ id: 'old-item', name: 'Pencils', count: 6, location: 'Supply closet' }],
    tasks: [{ id: 'old-task', itemId: 'old-item', itemName: 'Pencils', location: 'Supply closet', quantity: 2, remaining: 4, status: 'pending', createdAt: '2026-10-20T12:00:00.000Z' }],
  };
  const serialized = JSON.stringify(legacy);
  const storage = makeStorage({ [INVENTORY_STORAGE_KEY]: serialized });

  const migrated = loadInventoryState(storage, { idFactory: () => 'new-location' });

  assert.equal(storage.getItem(INVENTORY_BACKUP_KEY), serialized);
  assert.equal(JSON.parse(storage.getItem(INVENTORY_STORAGE_KEY)).schemaVersion, 2);
  assert.equal(migrated.inventoryItems[0].id, 'old-item');
  assert.equal(migrated.inventoryItems[0].quantityOnHand, 6);
  assert.equal(migrated.restockTasks[0].id, 'old-task');
  assert.equal(migrated.restockTasks[0].status, 'pending');
});
