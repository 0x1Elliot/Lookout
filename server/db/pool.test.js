import test from 'node:test';
import assert from 'node:assert/strict';
import {createPool} from './pool.js';

test('idle pool diagnostics never log the error, client or connection details', async () => {
  const pool=createPool('postgresql://fixture:synthetic@127.0.0.1:1/postgres');
  const messages=[],warn=console.warn;
  console.warn=(...args)=>messages.push(args);
  try {
    pool.emit('error',Object.assign(new Error('PRIVATE_FIXTURE_MESSAGE'),{connectionString:'PRIVATE_FIXTURE_URL'}),{password:'PRIVATE_FIXTURE_PASSWORD'});
    assert.deepEqual(messages,[['PostgreSQL idle connection lost; no operation was automatically retried.']]);
  } finally { console.warn=warn; await pool.end(); }
});
