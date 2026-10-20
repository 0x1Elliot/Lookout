export function createItem({ name, count, location }) {
  const cleanName = String(name ?? '').trim();
  const cleanLocation = String(location ?? '').trim();
  const units = Number(count);

  if (!cleanName) throw new Error('Enter an item name.');
  if (!cleanLocation) throw new Error('Enter where the item is stored.');
  if (!Number.isSafeInteger(units) || units < 0) throw new Error('Unit count must be a whole number of zero or more.');

  return { id: crypto.randomUUID(), name: cleanName, count: units, location: cleanLocation };
}

export function beginRestock(items, itemId, quantity) {
  const units = Number(quantity);
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error('Choose an inventory item.');
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error('Quantity must be a positive whole number.');
  if (units > item.count) throw new Error(`Only ${item.count} units are available at ${item.location}.`);

  const updatedItems = items.map((candidate) => candidate.id === itemId
    ? { ...candidate, count: candidate.count - units }
    : candidate);
  const task = {
    id: crypto.randomUUID(),
    itemId,
    itemName: item.name,
    location: item.location,
    quantity: units,
    remaining: item.count - units,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  return { items: updatedItems, task };
}

export function reconcileTask(items, tasks, taskId, outcome) {
  if (!['returned', 'shelf-restocked'].includes(outcome)) throw new Error('Choose Returned or Shelf restocked.');
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error('That restock task could not be found.');
  if (task.status !== 'pending') throw new Error('That restock task is already complete.');

  const updatedTasks = tasks.map((candidate) => candidate.id === taskId
    ? { ...candidate, status: outcome, completedAt: new Date().toISOString() }
    : candidate);
  if (outcome === 'shelf-restocked') return { items, tasks: updatedTasks };

  const item = items.find((candidate) => candidate.id === task.itemId);
  if (!item) throw new Error('The inventory item for this task could not be found.');
  const updatedItems = items.map((candidate) => candidate.id === item.id
    ? { ...candidate, count: candidate.count + task.quantity }
    : candidate);
  return { items: updatedItems, tasks: updatedTasks };
}
