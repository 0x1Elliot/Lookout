const publicAssets = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/startup.js', 'startup.js'],
  ['/secure-client.js', 'secure-client.js'],
  ['/agent-operations.js', 'agent-operations.js'],
  ['/dashboard.js', 'dashboard.js'],
  ['/dashboard-adapter.js', 'dashboard-adapter.js'],
  ['/dashboard-demo-data.js', 'dashboard-demo-data.js'],
  ['/inventory.js', 'inventory.js'],
  ['/inventory-storage.js', 'inventory-storage.js'],
  ['/styles.css', 'styles.css'],
]);

export function getPublicAsset(pathname) {
  return publicAssets.get(pathname);
}
