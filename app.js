import { connectBackend } from './secure-client.js';
import { mountAgentOperations } from './agent-operations.js';
import { mountAgentDashboard } from './dashboard.js';
import {
  addInventoryItem,
  beginRestock,
  createEmptyInventoryState,
  reconcileTask,
  restockInventoryItem,
} from './inventory.js';
import { loadInventoryState, saveInventoryState } from './inventory-storage.js';
const backend = await connectBackend();
let stateLoadError;
let state = backend ? backend.initial.inventory : loadState();
const itemForm = document.querySelector('#item-form');
const restockForm = document.querySelector('#restock-form');
const inventoryRestockForm = document.querySelector('#inventory-restock-form');
const itemSelect = document.querySelector('#restock-item');
const inventoryRestockSelect = document.querySelector('#inventory-restock-item');
const itemList = document.querySelector('#inventory-list');
const taskList = document.querySelector('#task-list');
const notice = document.querySelector('#notice');

function loadState() {
  try {
    return loadInventoryState(localStorage);
  } catch (error) {
    stateLoadError = error;
    return createEmptyInventoryState();
  }
}

function saveState() {
  if (backend) return;
  saveInventoryState(localStorage, state);
}

function showNotice(message, kind = 'success') {
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.hidden = false;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function locationFor(item) {
  return state.locations.find((location) => location.id === item.locationId);
}

function renderItems() {
  itemList.replaceChildren();
  itemSelect.replaceChildren(new Option('Select an item', ''));
  inventoryRestockSelect.replaceChildren(new Option('Select an item', ''));
  for (const item of state.inventoryItems) {
    const location = locationFor(item);
    const row = element('article', 'inventory-card');
    const details = element('div');
    details.append(element('h3', '', item.name), element('p', 'muted', `Stored at ${location?.name ?? 'Location unavailable'}`));
    const stock = element('div', 'stock-summary');
    const count = element('strong', 'unit-count', String(item.quantityOnHand));
    count.setAttribute('aria-label', `${item.quantityOnHand} units on hand`);
    stock.append(count, element('span', 'stock-caption', 'on hand'));
    row.append(details, stock);
    itemList.append(row);
    itemSelect.add(new Option(`${item.name} · ${item.quantityOnHand} available · ${location?.name ?? 'location unavailable'}`, item.id));
    inventoryRestockSelect.add(new Option(`${item.name} · ${item.quantityOnHand} on hand · ${location?.name ?? 'location unavailable'}`, item.id));
  }
  document.querySelector('#empty-inventory').hidden = state.inventoryItems.length > 0;
}

function renderTasks() {
  taskList.replaceChildren();
  const pending = state.restockTasks.filter((task) => task.status === 'pending');
  document.querySelector('#empty-tasks').hidden = pending.length > 0;
  for (const task of pending) {
    const card = element('article', 'task-card');
    const summary = element('div');
    summary.append(
      element('h3', '', task.itemName),
      element('p', 'muted', `From ${task.locationName} · ${task.quantity} ${task.quantity === 1 ? 'unit' : 'units'} moved`),
      element('p', 'math-line', `${task.quantityBefore} − ${task.quantity} = ${task.quantityAfter} on hand`),
      element('p', 'task-guidance', 'Choose Returned to restore these units, or Shelf restocked to keep the deduction.'),
    );
    const actions = element('div', 'task-actions');
    const returned = element('button', 'button button-secondary', 'Returned');
    returned.type = 'button';
    returned.addEventListener('click', () => finishTask(task.id, 'returned'));
    const restocked = element('button', 'button button-primary', 'Shelf restocked');
    restocked.type = 'button';
    restocked.addEventListener('click', () => finishTask(task.id, 'shelf-restocked'));
    actions.append(returned, restocked);
    card.append(summary, actions);
    taskList.append(card);
  }
}

function activityMessage(entry) {
  if (entry.type === 'inventory-item-added') return `Inventory added · ${entry.itemName} · ${entry.quantity} ${entry.quantity === 1 ? 'unit' : 'units'} at ${entry.locationName}`;
  if (entry.type === 'inventory-item-restocked') return `Items restocked · ${entry.quantity} ${entry.quantity === 1 ? 'unit' : 'units'} added to ${entry.itemName} at ${entry.locationName}`;
  if (entry.type === 'inventory-count-adjusted') return `Verified count updated · ${entry.itemName} · ${entry.previousQuantity} → ${entry.quantityRemaining} at ${entry.locationName} after human review`;
  if (entry.type === 'restock-started') return `Restock started · ${entry.quantity} ${entry.itemName} moved from ${entry.locationName}`;
  if (entry.type === 'returned') return `Returned · ${entry.quantity} ${entry.itemName} restored to ${entry.locationName}`;
  if (entry.type === 'shelf-restocked') return `Shelf restocked · ${entry.quantity} ${entry.itemName} from ${entry.locationName}`;
  return 'Inventory activity recorded';
}

function renderActivity() {
  const historyList = document.querySelector('#history-list');
  historyList.replaceChildren();
  document.querySelector('#empty-history').hidden = state.activity.length > 0;
  for (const entry of state.activity) {
    const row = element('article', 'history-card');
    const details = element('div');
    const remaining = Number.isSafeInteger(entry.quantityRemaining)
      ? `${entry.quantityRemaining} ${entry.quantityRemaining === 1 ? 'unit' : 'units'} on hand afterward · `
      : '';
    details.append(
      element('div', '', activityMessage(entry)),
      element('p', 'muted', `${remaining}${new Date(entry.createdAt).toLocaleString()}`),
    );
    row.append(details);
    row.dataset.activityType = entry.type;
    historyList.append(row);
  }
}

let agentOperations;
function render() {
  renderItems();
  renderTasks();
  renderActivity();
  agentOperations?.refresh();
  if (backend?.initial.identity.role === 'reviewer') document.querySelectorAll('#item-form input, #item-form button, #inventory-restock-form select, #inventory-restock-form input, #inventory-restock-form button, #restock-form select, #restock-form input, #restock-form button, .task-actions button').forEach(control => { control.disabled = true; });
}

async function finishTask(taskId, outcome) {
  try {
    state = backend ? (await backend.mutate('finish', { taskId, outcome })).inventory : reconcileTask(state, taskId, outcome);
    saveState();
    render();
    showNotice(outcome === 'returned' ? 'Returned to inventory. The units are available again.' : 'Shelf restock recorded. Inventory remains reduced.');
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

itemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(itemForm);
    const item = { name: form.get('name'), count: form.get('count'), location: form.get('location') };
    state = backend ? (await backend.mutate('add', { item })).inventory : addInventoryItem(state, item);
    saveState();
    itemForm.reset();
    render();
    showNotice('Inventory item added.');
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

inventoryRestockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(inventoryRestockForm);
    state = backend ? (await backend.mutate('receive', { itemId: form.get('itemId'), quantity: form.get('quantity') })).inventory : restockInventoryItem(state, form.get('itemId'), form.get('quantity'));
    saveState();
    const entry = state.activity[0];
    inventoryRestockForm.reset();
    render();
    showNotice(`${entry.quantity} ${entry.quantity === 1 ? 'unit' : 'units'} added to ${entry.itemName}. ${entry.quantityRemaining} on hand.`);
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

restockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(restockForm);
    state = backend ? (await backend.mutate('begin', { itemId: form.get('itemId'), quantity: form.get('quantity') })).inventory : beginRestock(state, form.get('itemId'), form.get('quantity'));
    const task = state.restockTasks[0];
    saveState();
    restockForm.reset();
    render();
    showNotice(`${task.quantity} units moved to a shelf restock. ${task.quantityAfter} remain in inventory.`);
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

render();
if (stateLoadError) {
  itemForm.querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
  restockForm.querySelectorAll('select, input, button').forEach((control) => { control.disabled = true; });
  inventoryRestockForm.querySelectorAll('select, input, button').forEach((control) => { control.disabled = true; });
  showNotice('Saved inventory could not be read and was left unchanged. The editing controls are disabled to protect that data.', 'error');
}

agentOperations = mountAgentOperations({
  getInventory: () => state,
  canReview: !backend || ['reviewer', 'admin'].includes(backend.initial.identity.role),
  canAct: !backend || ['worker', 'admin'].includes(backend.initial.identity.role),
  canCreate: !backend || ['worker', 'admin'].includes(backend.initial.identity.role),
  postWorkflow: backend?.workflow,
  loadWorkflow: backend ? async () => {
    const result = await backend.read(); state = result.inventory; render(); return result.workflow;
  } : undefined,
  updateInventory(next) {
    // Persist first: storage failure must not silently claim success.
    if (!backend) saveInventoryState(localStorage, next);
    state = next;
    render();
  },
  async addSample() {
    const stateBeforeSample = new Set(state.inventoryItems.map(item => item.id));
    const item = { name: 'Synthetic demo notebooks', count: 8, location: 'Demo back room' };
    const next = backend ? (await backend.mutate('add', { item })).inventory : addInventoryItem(state, item);
    if (!backend) saveInventoryState(localStorage, next);
    state = next;
    render();
    return next.inventoryItems.find(item => !stateBeforeSample.has(item.id));
  },
  disabled: Boolean(stateLoadError),
});

mountAgentDashboard({ container: document.getElementById('agent-dashboard') });
