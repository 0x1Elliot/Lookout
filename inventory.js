export const INVENTORY_SCHEMA_VERSION = 2;

function newId() {
  return crypto.randomUUID();
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalizeLocationKey(value) {
  return cleanText(value).toLowerCase();
}

function requireQuantity(value, label, { allowZero = false } = {}) {
  const isDecimalInput = typeof value === 'number'
    || (typeof value === 'string' && /^\d+$/.test(value.trim()));
  const quantity = Number(value);
  const min = allowZero ? 0 : 1;
  if (!isDecimalInput || !Number.isSafeInteger(quantity) || quantity < min) {
    const description = allowZero ? 'a whole number of zero or more' : 'a positive whole number';
    throw new Error(`${label} must be ${description}.`);
  }
  return quantity;
}

export function createEmptyInventoryState() {
  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    inventoryItems: [],
    locations: [],
    restockTasks: [],
    activity: [],
  };
}

function makeActivity({ idFactory, type, item, location, quantity, quantityRemaining, taskId, createdAt }) {
  return {
    id: idFactory(),
    type,
    itemId: item.id,
    itemName: item.name,
    locationId: location.id,
    locationName: location.name,
    quantity,
    quantityRemaining,
    taskId,
    createdAt,
  };
}

export function addInventoryItem(state, { name, count, location }, { idFactory = newId, now = () => new Date().toISOString() } = {}) {
  const cleanName = cleanText(name);
  const cleanLocation = cleanText(location);
  const quantityOnHand = requireQuantity(count, 'Unit count', { allowZero: true });

  if (!cleanName) throw new Error('Enter an item name.');
  if (!cleanLocation) throw new Error('Enter where the item is stored.');

  let matchedLocation = state.locations.find((candidate) => normalizeLocationKey(candidate.name) === normalizeLocationKey(cleanLocation));
  let locations = state.locations;
  if (!matchedLocation) {
    matchedLocation = { id: idFactory(), name: cleanLocation };
    locations = [...locations, matchedLocation];
  }

  const item = {
    id: idFactory(),
    name: cleanName,
    locationId: matchedLocation.id,
    quantityOnHand,
  };
  const createdAt = now();
  const event = makeActivity({
    idFactory,
    type: 'inventory-item-added',
    item,
    location: matchedLocation,
    quantity: quantityOnHand,
    quantityRemaining: quantityOnHand,
    createdAt,
  });

  return {
    ...state,
    inventoryItems: [...state.inventoryItems, item],
    locations,
    activity: [event, ...state.activity],
  };
}

export function restockInventoryItem(state, itemId, quantity, { idFactory = newId, now = () => new Date().toISOString() } = {}) {
  const units = requireQuantity(quantity, 'Quantity');
  const item = state.inventoryItems.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error('Choose an inventory item.');
  const location = state.locations.find((candidate) => candidate.id === item.locationId);
  if (!location) throw new Error('The inventory item location could not be found.');
  const quantityAfter = item.quantityOnHand + units;
  if (!Number.isSafeInteger(quantityAfter)) throw new Error('Restocked units would exceed the supported inventory count.');
  const event = makeActivity({
    idFactory,
    type: 'inventory-item-restocked',
    item,
    location,
    quantity: units,
    quantityRemaining: quantityAfter,
    createdAt: now(),
  });
  return {
    ...state,
    inventoryItems: state.inventoryItems.map((candidate) => candidate.id === item.id
      ? { ...candidate, quantityOnHand: quantityAfter }
      : candidate),
    activity: [event, ...state.activity],
  };
}

export function beginRestock(state, itemId, quantity, { idFactory = newId, now = () => new Date().toISOString() } = {}) {
  const units = requireQuantity(quantity, 'Quantity');
  const item = state.inventoryItems.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error('Choose an inventory item.');
  if (units > item.quantityOnHand) {
    const location = state.locations.find((candidate) => candidate.id === item.locationId);
    throw new Error(`Only ${item.quantityOnHand} units are available at ${location?.name ?? 'this location'}.`);
  }

  const location = state.locations.find((candidate) => candidate.id === item.locationId);
  if (!location) throw new Error('The inventory item location could not be found.');

  const quantityAfter = item.quantityOnHand - units;
  const task = {
    id: idFactory(),
    itemId: item.id,
    itemName: item.name,
    locationId: location.id,
    locationName: location.name,
    quantity: units,
    quantityBefore: item.quantityOnHand,
    quantityAfter,
    status: 'pending',
    createdAt: now(),
  };
  const event = makeActivity({
    idFactory,
    type: 'restock-started',
    item,
    location,
    quantity: units,
    quantityRemaining: quantityAfter,
    taskId: task.id,
    createdAt: task.createdAt,
  });

  return {
    ...state,
    inventoryItems: state.inventoryItems.map((candidate) => candidate.id === item.id
      ? { ...candidate, quantityOnHand: quantityAfter }
      : candidate),
    restockTasks: [task, ...state.restockTasks],
    activity: [event, ...state.activity],
  };
}

export function reconcileTask(state, taskId, outcome, { idFactory = newId, now = () => new Date().toISOString() } = {}) {
  if (!['returned', 'shelf-restocked'].includes(outcome)) throw new Error('Choose Returned or Shelf restocked.');
  const task = state.restockTasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error('That restock task could not be found.');
  if (task.status !== 'pending') throw new Error('That restock task is already complete.');

  const item = state.inventoryItems.find((candidate) => candidate.id === task.itemId);
  const location = state.locations.find((candidate) => candidate.id === task.locationId);
  if (!item || !location) throw new Error('The inventory record for this task could not be found.');

  const quantityAfter = outcome === 'returned' ? item.quantityOnHand + task.quantity : item.quantityOnHand;
  if (!Number.isSafeInteger(quantityAfter)) throw new Error('Returned units would exceed the supported inventory count.');
  const updatedTask = { ...task, status: outcome, completedAt: now() };
  const event = makeActivity({
    idFactory,
    type: outcome,
    item: { id: task.itemId, name: task.itemName },
    location: { id: task.locationId, name: task.locationName },
    quantity: task.quantity,
    quantityRemaining: quantityAfter,
    taskId: task.id,
    createdAt: updatedTask.completedAt,
  });

  return {
    ...state,
    inventoryItems: outcome === 'returned'
      ? state.inventoryItems.map((candidate) => candidate.id === item.id
        ? { ...candidate, quantityOnHand: quantityAfter }
        : candidate)
      : state.inventoryItems,
    restockTasks: state.restockTasks.map((candidate) => candidate.id === task.id ? updatedTask : candidate),
    activity: [event, ...state.activity],
  };
}

function migrateLegacyState(legacy, { idFactory, now }) {
  const locations = [];
  const inventoryItems = [];
  const locationByName = new Map();

  for (const oldItem of legacy.items) {
    const name = cleanText(oldItem.name);
    const locationName = cleanText(oldItem.location);
    const quantityOnHand = requireQuantity(oldItem.count, 'Saved unit count', { allowZero: true });
    if (!oldItem.id || !name || !locationName) throw new Error('A saved inventory item is missing its name, location, or ID.');

    const key = normalizeLocationKey(locationName);
    let location = locationByName.get(key);
    if (!location) {
      location = { id: idFactory(), name: locationName };
      locationByName.set(key, location);
      locations.push(location);
    }
    inventoryItems.push({ id: oldItem.id, name, locationId: location.id, quantityOnHand });
  }

  const restockTasks = legacy.tasks.map((oldTask) => {
    const item = inventoryItems.find((candidate) => candidate.id === oldTask.itemId);
    const itemLocation = locations.find((candidate) => candidate.id === item?.locationId);
    const locationName = cleanText(oldTask.location) || itemLocation?.name;
    const location = locations.find((candidate) => normalizeLocationKey(candidate.name) === normalizeLocationKey(locationName));
    const quantity = requireQuantity(oldTask.quantity, 'Saved task quantity');
    const quantityAfter = requireQuantity(oldTask.remaining, 'Saved remaining quantity', { allowZero: true });
    if (!oldTask.id || !oldTask.itemId || !oldTask.itemName || !location || !['pending', 'returned', 'shelf-restocked'].includes(oldTask.status)) {
      throw new Error('A saved restock task is incomplete and could not be migrated.');
    }
    return {
      id: oldTask.id,
      itemId: oldTask.itemId,
      itemName: cleanText(oldTask.itemName),
      locationId: location.id,
      locationName: location.name,
      quantity,
      quantityBefore: quantityAfter + quantity,
      quantityAfter,
      status: oldTask.status,
      createdAt: oldTask.createdAt ?? now(),
      ...(oldTask.completedAt ? { completedAt: oldTask.completedAt } : {}),
    };
  });

  const activity = [];
  for (const task of restockTasks) {
    const item = { id: task.itemId, name: task.itemName };
    const location = { id: task.locationId, name: task.locationName };
    activity.push(makeActivity({
      idFactory,
      type: 'restock-started',
      item,
      location,
      quantity: task.quantity,
      quantityRemaining: task.quantityAfter,
      taskId: task.id,
      createdAt: task.createdAt,
    }));
    if (task.status !== 'pending') {
      activity.push(makeActivity({
        idFactory,
        type: task.status,
        item,
        location,
        quantity: task.quantity,
        quantityRemaining: undefined,
        taskId: task.id,
        createdAt: task.completedAt ?? task.createdAt,
      }));
    }
  }

  activity.sort((left, right) => {
    const timeDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (timeDifference !== 0) return timeDifference;
    if (left.type === 'restock-started' && right.type !== 'restock-started') return 1;
    if (right.type === 'restock-started' && left.type !== 'restock-started') return -1;
    return 0;
  });

  return { ...createEmptyInventoryState(), inventoryItems, locations, restockTasks, activity };
}

function validateInventoryState(state) {
  const locationIds = new Set();
  for (const location of state.locations) {
    if (!location?.id || !cleanText(location.name) || locationIds.has(location.id)) {
      throw new Error('Saved inventory contains an invalid or duplicate location.');
    }
    locationIds.add(location.id);
  }

  const itemIds = new Set();
  for (const item of state.inventoryItems) {
    if (!item?.id || !cleanText(item.name) || !locationIds.has(item.locationId)
      || !Number.isSafeInteger(item.quantityOnHand) || item.quantityOnHand < 0 || itemIds.has(item.id)) {
      throw new Error('Saved inventory contains an invalid item or location reference.');
    }
    itemIds.add(item.id);
  }

  const taskIds = new Set();
  const tasksById = new Map();
  for (const task of state.restockTasks) {
    const item = state.inventoryItems.find((candidate) => candidate.id === task?.itemId);
    if (!task?.id || !item || item.locationId !== task.locationId || !locationIds.has(task.locationId)
      || !cleanText(task.itemName) || !cleanText(task.locationName)
      || !['pending', 'returned', 'shelf-restocked'].includes(task.status)
      || !Number.isSafeInteger(task.quantity) || task.quantity <= 0
      || !Number.isSafeInteger(task.quantityBefore) || task.quantityBefore < 0
      || !Number.isSafeInteger(task.quantityAfter) || task.quantityAfter < 0
      || task.quantityBefore - task.quantity !== task.quantityAfter || taskIds.has(task.id)) {
      throw new Error('Saved inventory contains an invalid restock task.');
    }
    taskIds.add(task.id);
    tasksById.set(task.id, task);
  }

  const activityTypes = new Set(['inventory-item-added', 'inventory-item-restocked', 'restock-started', 'returned', 'shelf-restocked']);
  const activityIds = new Set();
  for (const entry of state.activity) {
    const task = entry?.taskId === undefined ? undefined : tasksById.get(entry.taskId);
    const isTaskActivity = !['inventory-item-added', 'inventory-item-restocked'].includes(entry?.type);
    if (!entry?.id || !activityTypes.has(entry.type) || !itemIds.has(entry.itemId) || !locationIds.has(entry.locationId)
      || (isTaskActivity && !task)
      || (task && (task.itemId !== entry.itemId || task.locationId !== entry.locationId))
      || (!isTaskActivity && entry.taskId !== undefined)
      || !cleanText(entry.itemName) || !cleanText(entry.locationName)
      || !Number.isSafeInteger(entry.quantity) || entry.quantity < 0
      || (entry.quantityRemaining !== undefined && (!Number.isSafeInteger(entry.quantityRemaining) || entry.quantityRemaining < 0))
      || !Number.isFinite(Date.parse(entry.createdAt)) || activityIds.has(entry.id)) {
      throw new Error('Saved inventory contains an invalid activity record.');
    }
    activityIds.add(entry.id);
  }
}

export function normalizeInventoryState(value, { idFactory = newId, now = () => new Date().toISOString() } = {}) {
  if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return createEmptyInventoryState();
  if (value.schemaVersion === INVENTORY_SCHEMA_VERSION) {
    const validArrays = ['inventoryItems', 'locations', 'restockTasks', 'activity'].every((key) => Array.isArray(value[key]));
    if (!validArrays) throw new Error('Saved inventory data is incomplete.');
    validateInventoryState(value);
    return value;
  }
  if (Array.isArray(value.items) && Array.isArray(value.tasks)) {
    const migrated = migrateLegacyState(value, { idFactory, now });
    validateInventoryState(migrated);
    return migrated;
  }
  throw new Error('Saved inventory data uses an unsupported format.');
}
