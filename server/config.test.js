import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAnthropicApiKey, getServerConfig, loadLocalEnv } from './config.js';

test('uses a safe default port and accepts a valid configured port', () => {
  assert.deepEqual(getServerConfig({}), { port: 4173 });
  assert.deepEqual(getServerConfig({ PORT: '5050' }), { port: 5050 });
});

test('rejects invalid port values with a clear message', () => {
  for (const PORT of ['', 'abc', '1.5', '0', '65536']) {
    assert.throws(() => getServerConfig({ PORT }), /PORT must be a whole number from 1 to 65535/);
  }
});

test('keeps the optional Anthropic key server-side and returns no empty value', () => {
  assert.equal(getAnthropicApiKey({}), undefined);
  assert.equal(getAnthropicApiKey({ ANTHROPIC_API_KEY: '   ' }), undefined);
  assert.equal(getAnthropicApiKey({ ANTHROPIC_API_KEY: ' test-key-placeholder ' }), 'test-key-placeholder');
});

test('loads a local environment file and safely allows it to be absent', async (t) => {
  const key = 'LOOKOUT_CONFIG_TEST_VALUE';
  const previousValue = process.env[key];
  const directory = await mkdtemp(join(tmpdir(), 'lookout-env-test-'));
  const envPath = join(directory, '.env');
  t.after(async () => {
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
    await rm(directory, { recursive: true, force: true });
  });

  delete process.env[key];
  await writeFile(envPath, `${key}=loaded\n`);
  loadLocalEnv(envPath);
  assert.equal(process.env[key], 'loaded');

  await rm(envPath);
  assert.doesNotThrow(() => loadLocalEnv(envPath));
});
