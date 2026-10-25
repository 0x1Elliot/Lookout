const activityTypes = new Set([
  'inventory-item-added',
  'inventory-item-restocked',
  'restock-started',
  'returned',
  'shelf-restocked',
]);

export function createAgentInventoryContext(value) {
  if (!value || value.schemaVersion !== 2
    || !Array.isArray(value.inventoryItems)
    || !Array.isArray(value.locations)
    || !Array.isArray(value.restockTasks)
    || !Array.isArray(value.activity)) {
    throw new Error('Inventory data is incomplete or unsupported.');
  }

  const locations = new Map(value.locations.map(({ id, name }) => [id, name]));
  const items = value.inventoryItems.map((item) => {
    if (!item.id || typeof item.name !== 'string' || !Number.isSafeInteger(item.quantityOnHand)
      || item.quantityOnHand < 0 || !locations.has(item.locationId)) {
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
  const pendingTasks = value.restockTasks
    .filter((task) => task.status === 'pending')
    .map((task) => {
      if (!task.id || !itemIds.has(task.itemId) || !Number.isSafeInteger(task.quantity) || task.quantity < 1) {
        throw new Error('Inventory data contains an invalid restock task.');
      }
      return { id: task.id, itemId: task.itemId, itemName: task.itemName, location: task.locationName, quantity: task.quantity };
    });

  const recentActivity = value.activity.slice(0, 20).map((entry) => {
    if (!activityTypes.has(entry.type) || !Number.isSafeInteger(entry.quantity)) {
      throw new Error('Inventory data contains an invalid activity entry.');
    }
    return {
      type: entry.type,
      itemName: entry.itemName,
      location: entry.locationName,
      quantity: entry.quantity,
      createdAt: entry.createdAt,
    };
  });

  return { items, pendingTasks, recentActivity };
}
