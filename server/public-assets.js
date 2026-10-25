const publicAssets = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/agent-operations.js', 'agent-operations.js'],
  ['/inventory.js', 'inventory.js'],
  ['/inventory-storage.js', 'inventory-storage.js'],
  ['/styles.css', 'styles.css'],
]);

export function getPublicAsset(pathname) {
  return publicAssets.get(pathname);
}
