const publicAssets = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/inventory.js', 'inventory.js'],
  ['/styles.css', 'styles.css'],
]);

export function getPublicAsset(pathname) {
  return publicAssets.get(pathname);
}
