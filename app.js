import { beginRestock, createItem, reconcileTask } from './inventory.js';

const STORAGE_KEY = 'lookout.inventory.v1';
const state = loadState();
const itemForm = document.querySelector('#item-form');
const restockForm = document.querySelector('#restock-form');
const itemSelect = document.querySelector('#restock-item');
const itemList = document.querySelector('#inventory-list');
const taskList = document.querySelector('#task-list');
const notice = document.querySelector('#notice');

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { items: Array.isArray(stored.items) ? stored.items : [], tasks: Array.isArray(stored.tasks) ? stored.tasks : [] };
  } catch {
    return { items: [], tasks: [] };
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

function renderItems() {
  itemList.replaceChildren();
  itemSelect.replaceChildren(new Option('Select an item', ''));
  for (const item of state.items) {
    const row = element('article', 'inventory-card');
    const details = element('div');
    details.append(element('h3', '', item.name), element('p', 'muted', `Stored at ${item.location}`));
    const count = element('strong', 'unit-count', String(item.count));
    count.setAttribute('aria-label', `${item.count} units available`);
    row.append(details, count);
    itemList.append(row);
    itemSelect.add(new Option(`${item.name} · ${item.count} available`, item.id));
  }
  document.querySelector('#empty-inventory').hidden = state.items.length > 0;
}

function renderTasks() {
  taskList.replaceChildren();
  const pending = state.tasks.filter((task) => task.status === 'pending');
  document.querySelector('#empty-tasks').hidden = pending.length > 0;
  const historyList = document.querySelector('#history-list');
  historyList.replaceChildren();
  const completed = state.tasks.filter((task) => task.status !== 'pending');
  document.querySelector('#empty-history').hidden = completed.length > 0;
  for (const task of pending) {
    const card = element('article', 'task-card');
    const summary = element('div');
    summary.append(
      element('h3', '', task.itemName),
      element('p', 'muted', `${task.quantity} units taken from ${task.location}`),
      element('p', 'math-line', `${task.remaining + task.quantity} − ${task.quantity} = ${task.remaining} units remaining`),
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
  for (const task of completed) {
    const row = element('article', 'history-card');
    const outcome = task.status === 'returned' ? 'Returned to inventory' : 'Shelf restocked';
    row.append(
      element('div', '', `${task.itemName} · ${task.quantity} units`),
      element('span', 'history-outcome', outcome),
    );
    historyList.append(row);
  }
}

function render() {
  renderItems();
  renderTasks();
}

function finishTask(taskId, outcome) {
  try {
    const result = reconcileTask(state.items, state.tasks, taskId, outcome);
    state.items = result.items;
    state.tasks = result.tasks;
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
    state.items.push(createItem({ name: form.get('name'), count: form.get('count'), location: form.get('location') }));
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
    const result = beginRestock(state.items, form.get('itemId'), form.get('quantity'));
    state.items = result.items;
    state.tasks.unshift(result.task);
    saveState();
    restockForm.reset();
    render();
    showNotice(`${result.task.quantity} units moved to a shelf restock. ${result.task.remaining} remain in inventory.`);
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

render();
