import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublicAsset } from './public-assets.js';

test('serves only the intended browser assets', () => {
  assert.equal(getPublicAsset('/'), 'index.html');
  assert.equal(getPublicAsset('/app.js'), 'app.js');
  assert.equal(getPublicAsset('/inventory.js'), 'inventory.js');
  assert.equal(getPublicAsset('/inventory-storage.js'), 'inventory-storage.js');
  assert.equal(getPublicAsset('/styles.css'), 'styles.css');
});

test('does not map environment files or server-side source to public URLs', () => {
  assert.equal(getPublicAsset('/.env'), undefined);
  assert.equal(getPublicAsset('/.env.example'), undefined);
  assert.equal(getPublicAsset('/server.mjs'), undefined);
  assert.equal(getPublicAsset('/server/config.js'), undefined);
});
