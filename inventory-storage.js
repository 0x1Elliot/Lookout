import { createEmptyInventoryState, normalizeInventoryState } from './inventory.js';

export const INVENTORY_STORAGE_KEY = 'lookout.inventory.v1';
export const INVENTORY_BACKUP_KEY = `${INVENTORY_STORAGE_KEY}.before-phase-3`;

export function loadInventoryState(storage, options) {
  const serialized = storage.getItem(INVENTORY_STORAGE_KEY);
  if (serialized === null) return createEmptyInventoryState();

  const stored = JSON.parse(serialized);
  const normalized = normalizeInventoryState(stored, options);
  if (stored.schemaVersion !== normalized.schemaVersion) {
    if (storage.getItem(INVENTORY_BACKUP_KEY) === null) storage.setItem(INVENTORY_BACKUP_KEY, serialized);
    storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function saveInventoryState(storage, state) {
  storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(state));
}
