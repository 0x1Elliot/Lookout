import test from 'node:test';
import assert from 'node:assert/strict';
import { secureConfig, bearer, authorize, tokenHash } from './security.js';
test('secure startup fails closed; explicit demo is forbidden in production', () => {
  assert.throws(() => secureConfig({}), /DATABASE_URL/);
  assert.throws(() => secureConfig({ LOOKOUT_MODE: 'demo', NODE_ENV: 'production' }), /forbidden/);
  assert.throws(() => secureConfig({ DATABASE_URL: 'postgres://user:secret@db.example/db?sslmode=require' }), /verify-full/);
  assert.equal(secureConfig({ DATABASE_URL: 'postgres://user:secret@db.example/db?sslmode=verify-full' }).mode, 'secure');
  assert.throws(() => secureConfig({ LOOKOUT_MODE: 'unknown' }));
});
test('bearer syntax and RBAC deny absent identity, unknown roles and worker review', () => {
  for (const authorization of [undefined, 'Basic aaa', 'Bearer short', ['Bearer abc']]) assert.throws(() => bearer({ authorization }), /Authentication/);
  assert.equal(bearer({ authorization: `Bearer ${'a'.repeat(43)}` }), tokenHash('a'.repeat(43)));
  assert.throws(() => authorize({ role: 'worker' }, 'review'), /forbidden/);
  assert.throws(() => authorize({ role: 'reviewer' }, 'action'), /forbidden/);
  assert.throws(() => authorize({ role: 'owner' }, 'read'), /forbidden/);
});
test('remote database TLS configuration rejects ambiguous modes and bypass parameters',()=>{
 for(const suffix of ['sslmode=verify-full&sslmode=disable','sslmode=verify-full&ssl=false','sslmode=verify-full&uselibpqcompat=true','sslmode=verify-full&sslnegotiation=direct']) {
  assert.throws(()=>secureConfig({DATABASE_URL:'postgresql://runtime@remote.example/db?'+suffix}));
 }
});
