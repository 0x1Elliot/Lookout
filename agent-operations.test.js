import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAgentOperations } from './agent-operations.js';
import { addInventoryItem, createEmptyInventoryState, restockInventoryItem } from './inventory.js';
import { inProcessTransport } from './scripts/check-agent-api.mjs';

// Small DOM adapter exercises the actual UI controller against the actual API handler.
class Node {
  value = ''; hidden = false; disabled = false; textContent = ''; children = []; handlers = {};
  addEventListener(name, callback) { this.handlers[name] = callback; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  add(child) { this.children.push(child); }
}
async function setup(t) {
  const ids = ['agent-trigger','agent-item','agent-count','agent-stages','agent-review-form','agent-apply','agent-sample','agent-status','agent-event-form','agent-evidence','agent-audit','agent-reviewer','agent-reason'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Node()]));
  const controls = ids.filter(id => !['agent-stages','agent-status','agent-evidence','agent-audit','agent-review-form','agent-event-form'].includes(id)).map(id => nodes[id]);
  const send = inProcessTransport();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const result = await send(JSON.parse(options.body)); return { ok: result.status === 200, json: async () => result.body };
  });
  const priorDocument = globalThis.document, priorOption = globalThis.Option;
  globalThis.document = { getElementById: id => nodes[id], createElement: () => new Node(), querySelectorAll: () => controls };
  globalThis.Option = class extends Node { constructor(text, value) { super(); this.textContent = text; this.value = value; } };
  t.after(() => { globalThis.document = priorDocument; globalThis.Option = priorOption; });
  let inventory = addInventoryItem(createEmptyInventoryState(), { name: 'Synthetic UI test', count: 8, location: 'Test room' });
  let failSave = false;
  const controller = mountAgentOperations({ getInventory: () => inventory, updateInventory(next) { if (failSave) throw new Error('Storage unavailable'); inventory = next; }, addSample() {} });
  nodes['agent-item'].value = inventory.inventoryItems[0].id; nodes['agent-count'].value = '5';
  nodes['agent-reviewer'].value = 'Test human'; nodes['agent-reason'].value = 'Synthetic count reviewed.';
  async function dispatch(id, name = 'click', outcome) {
    nodes[id].handlers[name]({ preventDefault() {}, submitter: { value: outcome } });
    await new Promise(resolve => setImmediate(resolve));
  }
  return { nodes, dispatch, getInventory: () => inventory, failSave: value => { failSave = value; },
    changeInventory() { inventory = restockInventoryItem(inventory, inventory.inventoryItems[0].id, 1); controller.refresh(); } };
}
test('dashboard uses real API stages and only changes inventory after explicit approval and apply', async t => {
  const ui = await setup(t);
  await ui.dispatch('agent-event-form', 'submit');
  assert.match(ui.nodes['agent-evidence'].children.map(n => n.textContent).join(' '), /differ by -3.*cause.*unknown/);
  assert.equal(ui.getInventory().inventoryItems[0].quantityOnHand, 8);
  await ui.dispatch('agent-review-form', 'submit', 'approve');
  assert.equal(ui.getInventory().inventoryItems[0].quantityOnHand, 8);
  await ui.dispatch('agent-apply');
  assert.equal(ui.getInventory().inventoryItems[0].quantityOnHand, 5);
  assert.equal(ui.getInventory().activity[0].type, 'inventory-count-adjusted');
  assert.match(ui.nodes['agent-audit'].textContent, /evidenceIds/);
  assert.equal(ui.nodes['agent-apply'].hidden, true);
});
test('dashboard rejection records decision and keeps inventory unchanged', async t => {
  const ui = await setup(t); await ui.dispatch('agent-event-form', 'submit');
  await ui.dispatch('agent-review-form', 'submit', 'reject');
  assert.equal(ui.getInventory().inventoryItems[0].quantityOnHand, 8);
  assert.match(ui.nodes['agent-audit'].textContent, /rejected/);
  assert.equal(ui.nodes['agent-apply'].hidden, true);
});
test('dashboard surfaces stale inventory instead of replacing restocked inventory', async t => {
  const ui = await setup(t); await ui.dispatch('agent-event-form', 'submit');
  await ui.dispatch('agent-review-form', 'submit', 'approve'); ui.changeInventory();
  await ui.dispatch('agent-apply');
  assert.equal(ui.getInventory().inventoryItems[0].quantityOnHand, 9);
  assert.match(ui.nodes['agent-status'].textContent, /changed since reconciliation/);
});
test('dashboard can retry saving a successful action after browser storage failure', async t => {
  const ui = await setup(t); await ui.dispatch('agent-event-form', 'submit');
  await ui.dispatch('agent-review-form', 'submit', 'approve'); ui.failSave(true);
  await ui.dispatch('agent-apply');
  assert.equal(ui.nodes['agent-apply'].hidden, false);
  assert.equal(ui.getInventory().inventoryItems[0].quantityOnHand, 8);
  ui.failSave(false); await ui.dispatch('agent-apply');
  assert.equal(ui.getInventory().inventoryItems[0].quantityOnHand, 5);
  assert.equal(ui.getInventory().activity.filter(a => a.type === 'inventory-count-adjusted').length, 1);
});
