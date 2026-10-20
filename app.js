import {
  addInventoryItem,
  beginRestock,
  createEmptyInventoryState,
  normalizeInventoryState,
  reconcileTask,
} from './inventory.js';

const STORAGE_KEY = 'lookout.inventory.v1';
const BACKUP_KEY = `${STORAGE_KEY}.before-phase-3`;
let stateLoadError;
let state = loadState();
const itemForm = document.querySelector('#item-form');
const restockForm = document.querySelector('#restock-form');
const itemSelect = document.querySelector('#restock-item');
const itemList = document.querySelector('#inventory-list');
const taskList = document.querySelector('#task-list');
const notice = document.querySelector('#notice');

function loadState() {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (serialized === null) return createEmptyInventoryState();

    const stored = JSON.parse(serialized);
    const normalized = normalizeInventoryState(stored);
    if (stored.schemaVersion !== normalized.schemaVersion) {
      if (localStorage.getItem(BACKUP_KEY) === null) localStorage.setItem(BACKUP_KEY, serialized);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch (error) {
    stateLoadError = error;
    return createEmptyInventoryState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  for (const item of state.inventoryItems) {
    const location = locationFor(item);
    const row = element('article', 'inventory-card');
    const details = element('div');
    details.append(element('h3', '', item.name), element('p', 'muted', `Stored at ${location?.name ?? 'Location unavailable'}`));
    const count = element('strong', 'unit-count', String(item.quantityOnHand));
    count.setAttribute('aria-label', `${item.quantityOnHand} units available`);
    row.append(details, count);
    itemList.append(row);
    itemSelect.add(new Option(`${item.name} · ${item.quantityOnHand} available · ${location?.name ?? 'location unavailable'}`, item.id));
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
      element('p', 'muted', `${task.quantity} units taken from ${task.locationName}`),
      element('p', 'math-line', `${task.quantityBefore} − ${task.quantity} = ${task.quantityAfter} units remaining`),
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
  if (entry.type === 'inventory-item-added') return `Added ${entry.itemName} · ${entry.quantity} units at ${entry.locationName}`;
  if (entry.type === 'restock-started') return `Started shelf restock · ${entry.quantity} ${entry.itemName} from ${entry.locationName}`;
  if (entry.type === 'returned') return `Returned ${entry.quantity} ${entry.itemName} to ${entry.locationName}`;
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
      ? `${entry.quantityRemaining} units remain in recorded inventory · `
      : '';
    details.append(
      element('div', '', activityMessage(entry)),
      element('p', 'muted', `${remaining}${new Date(entry.createdAt).toLocaleString()}`),
    );
    row.append(details);
    historyList.append(row);
  }
}

function render() {
  renderItems();
  renderTasks();
  renderActivity();
}

function finishTask(taskId, outcome) {
  try {
    state = reconcileTask(state, taskId, outcome);
    saveState();
    render();
    showNotice(outcome === 'returned' ? 'Returned to inventory. The units are available again.' : 'Shelf restock recorded. Inventory remains reduced.');
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

itemForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const form = new FormData(itemForm);
    state = addInventoryItem(state, { name: form.get('name'), count: form.get('count'), location: form.get('location') });
    saveState();
    itemForm.reset();
    render();
    showNotice('Inventory item added.');
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

restockForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const form = new FormData(restockForm);
    state = beginRestock(state, form.get('itemId'), form.get('quantity'));
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
  showNotice('Saved inventory could not be read and was left unchanged. The editing controls are disabled to protect that data.', 'error');
}
