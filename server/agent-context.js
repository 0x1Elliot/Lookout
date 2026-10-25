const activityTypes = new Set([
  'inventory-item-added',
  'inventory-item-restocked',
  'restock-started',
  'returned',
  'shelf-restocked',
  'inventory-count-adjusted',
]);

export function createAgentInventoryContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 2
    || !Array.isArray(value.inventoryItems)
    || !Array.isArray(value.locations)
    || !Array.isArray(value.restockTasks)
    || !Array.isArray(value.activity)) {
    throw new Error('Inventory data is incomplete or unsupported.');
  }

  const locations = new Map();
  for (const location of value.locations) {
    if (!location || typeof location.id !== 'string' || !location.id.trim()
      || typeof location.name !== 'string' || !location.name.trim() || locations.has(location.id)) {
      throw new Error('Inventory data contains an invalid location.');
    }
    locations.set(location.id, location.name);
  }
  const items = value.inventoryItems.map((item) => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || !item.name.trim()
      || !Number.isSafeInteger(item.quantityOnHand) || item.quantityOnHand < 0 || !locations.has(item.locationId)) {
      throw new Error('Inventory data contains an invalid item.');
    }
    return {
      id: item.id,
      name: item.name,
      location: locations.get(item.locationId),
      quantityOnHand: item.quantityOnHand,
    };
  });

  const itemIds = new Set(items.map(({ id }) => id));
  if (itemIds.size !== items.length) throw new Error('Inventory data contains a duplicate item.');
  const pendingTasks = value.restockTasks
    .filter((task) => task.status === 'pending')
    .map((task) => {
      if (!task || typeof task.id !== 'string' || !task.id.trim() || !itemIds.has(task.itemId)
        || typeof task.itemName !== 'string' || !task.itemName.trim()
        || typeof task.locationName !== 'string' || !task.locationName.trim()
        || !Number.isSafeInteger(task.quantity) || task.quantity < 1) {
        throw new Error('Inventory data contains an invalid restock task.');
      }
      return { id: task.id, itemId: task.itemId, itemName: task.itemName, location: task.locationName, quantity: task.quantity };
    });

  const recentActivity = value.activity.slice(0, 20).map((entry) => {
    if (!entry || !activityTypes.has(entry.type) || typeof entry.itemName !== 'string' || !entry.itemName.trim()
      || typeof entry.locationName !== 'string' || !entry.locationName.trim()
      || !Number.isSafeInteger(entry.quantity) || entry.quantity < 0
      || typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt))) {
      throw new Error('Inventory data contains an invalid activity entry.');
    }
    return {
      type: entry.type,
      itemName: entry.itemName,
      location: entry.locationName,
      quantity: entry.quantity,
      createdAt: entry.createdAt,
      ...(entry.type === 'inventory-count-adjusted' ? {
        eventId: entry.eventId,
        caseId: entry.caseId,
        actionRequestId: entry.actionRequestId,
        reviewerId: entry.reviewerId,
        previousQuantity: entry.previousQuantity,
        quantityOnHand: entry.quantityRemaining,
        evidenceIds: entry.evidenceIds,
      } : {}),
    };
  });

  return { items, pendingTasks, recentActivity };
}
