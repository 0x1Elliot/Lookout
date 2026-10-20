import test from 'node:test';
import assert from 'node:assert/strict';
import { beginRestock, createItem, reconcileTask } from './inventory.js';

const item = { id: 'item-1', name: 'Test item', count: 12, location: 'Back room A' };
const task = { id: 'task-1', itemId: item.id, itemName: item.name, location: item.location, quantity: 4, remaining: 8, status: 'pending' };

test('creates an item from supplied details and rejects invalid counts', () => {
  const created = createItem({ name: ' Pens ', count: '8', location: 'Shelf A' });
  assert.match(created.id, /^[0-9a-f-]{36}$/i);
  assert.deepEqual({ name: created.name, count: created.count, location: created.location }, {
    name: 'Pens', count: 8, location: 'Shelf A',
  });
  assert.throws(() => createItem({ name: 'Pens', count: '-1', location: 'Shelf A' }), /whole number/);
  assert.throws(() => createItem({ name: 'Pens', count: '1.5', location: 'Shelf A' }), /whole number/);
  assert.throws(() => createItem({ name: '', count: '1', location: 'Shelf A' }), /item name/);
});

test('beginning a restock immediately deducts units and reports the remaining count', () => {
  const result = beginRestock([item], item.id, '5');
  assert.equal(result.items[0].count, 7);
  assert.equal(result.task.remaining, 7);
  assert.equal(result.task.quantity, 5);
  assert.equal(result.task.status, 'pending');
});

test('rejects a restock quantity that exceeds available inventory', () => {
  assert.throws(() => beginRestock([item], item.id, '13'), /Only 12 units are available at Back room A/);
  assert.throws(() => beginRestock([item], item.id, '0'), /positive whole number/);
});

test('returned items are added back; shelf restocked keeps the immediate deduction', () => {
  const returned = reconcileTask([{ ...item, count: 8 }], [task], task.id, 'returned');
  assert.equal(returned.items[0].count, 12);
  assert.equal(returned.tasks[0].status, 'returned');

  const restocked = reconcileTask([{ ...item, count: 8 }], [task], task.id, 'shelf-restocked');
  assert.equal(restocked.items[0].count, 8);
  assert.equal(restocked.tasks[0].status, 'shelf-restocked');
});

test('prevents a completed task from being reconciled twice', () => {
  assert.throws(() => reconcileTask([{ ...item, count: 8 }], [{ ...task, status: 'returned' }], task.id, 'returned'), /already complete/);
});

test('rejects unknown reconciliation outcomes and missing records', () => {
  assert.throws(() => reconcileTask([item], [task], task.id, 'lost'), /Choose Returned or Shelf restocked/);
  assert.throws(() => reconcileTask([item], [], task.id, 'returned'), /could not be found/);
});
