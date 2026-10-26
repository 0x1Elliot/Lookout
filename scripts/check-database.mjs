import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { localPostgres, provisionTenant, secret } from './lib/local-postgres.mjs';
import { createPool, verifyRuntime } from '../server/db/pool.js';
import { PostgresStore } from '../server/db/store.js';
import { tokenHash } from '../server/security.js';
import { createSecureHandler } from '../server/secure-handler.js';
await mkdir('work', { recursive: true });
const dir = await mkdtemp(resolve('work/test-db-'));
let local, pool, server;
let checks = 0;
function passed(message) { checks++; console.log(`PASS ${message}`); }
try {
  local = await localPostgres(dir, Number(process.env.TEST_DB_PORT ?? 55439));
  const identities = ['worker','reviewer','admin'].map(role => ({ id: role, name: `Trusted ${role}`, role, token: secret() }));
  await provisionTenant(local.owner, 'one', identities);
  const other = { id: 'other', name: 'Other tenant', role: 'admin', token: secret() };
  await provisionTenant(local.owner, 'two', [other]);
  const tokens = Object.fromEntries(identities.map(x => [x.id, x.token]));
  pool = createPool(local.runtimeUrl); await verifyRuntime(pool);
  await assert.rejects(verifyRuntime(local.owner), /Unsafe/); passed('runtime role restrictions; owner rejected');
  let store = new PostgresStore(pool);
  const hash = role => tokenHash(tokens[role]);
  const execute = async (role, path, body) => {
    const response = await http(path === 'inventory' ? '/api/inventory' : '/api/agent/workflow', {
      method: 'POST', headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID(), ...body }),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), { statusCode: response.status });
    return result;
  };
  server = createServer(createSecureHandler(store, (_req,res) => res.writeHead(404).end()));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = (path, options = {}) => fetch(base+path, options);
  assert.equal((await http('/api/inventory')).status, 401);
  assert.equal((await http('/api/inventory', { headers: { Authorization: `Bearer ${secret()}` } })).status, 401);
  assert.equal((await http('/api/inventory', { headers: { Authorization: `Bearer ${tokens.worker}`, 'sec-fetch-site': 'cross-site' } })).status, 403);
  passed('HTTP denies missing, invalid credentials and cross-site requests');
  const authHeaders = { Authorization: `Bearer ${tokens.worker}`, 'Content-Type': 'application/json' };
  const readResponse = await http('/api/agent/workflow', { headers: authHeaders });
  assert.equal(readResponse.status,200); assert.equal(readResponse.headers.get('cache-control'),'no-store');
  assert.match(readResponse.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await http('/api/inventory', { method:'DELETE',headers:authHeaders })).status,405);
  assert.equal((await http('/api/inventory', { method:'POST',headers:{Authorization:authHeaders.Authorization},body:'{}' })).status,415);
  assert.equal((await http('/api/inventory', { method:'POST',headers:authHeaders,body:'{' })).status,400);
  assert.equal((await http('/api/inventory', { method:'POST',headers:authHeaders,body:'x'.repeat(1_000_001) })).status,413);
  assert.equal((await http('/api/unknown', { method:'POST',headers:authHeaders,body:'{}' })).status,404);
  passed('HTTP media, size, method, JSON and route checks; CSP and no-store headers');
  await assert.rejects(execute('worker','workflow',{stage:'review'}), e => e.statusCode === 403);
  await assert.rejects(execute('reviewer','inventory',{operation:'add',expectedRevision:0,item:{name:'x',count:1,location:'x'}}), e => e.statusCode === 403);
  passed('worker cannot review; reviewer cannot mutate stock');
  const added = await execute('worker','inventory',{operation:'add', expectedRevision:0,item:{name:"Notebook'); DROP TABLE lookout.items; --",count:8,location:'A'}});
  const itemId = added.inventory.inventoryItems[0].id;
  assert.equal(added.revision,1); passed('parameterized item insert retains SQL-like text');
  const timestamp = new Date().toISOString();
  const event = id => ({ eventId:id, occurredAt:timestamp, source:'synthetic/database-test',type:'inventory-count-observed',itemId, observedQuantity:5,
    evidence:[{id:'sheet-'+id,kind:'manual-count-sheet',description:'Synthetic five units',observedAt:timestamp,observedQuantity:5}] });
  async function prepare(id) {
    await execute('worker','workflow',{stage:'intake',event:event(id)});
    return execute('worker','workflow',{stage:'reconcile',eventId:id});
  }
  const reconciled = await prepare('count-1'); const caseId = reconciled.caseRecord.caseId;
  await assert.rejects(execute('worker','workflow',{stage:'action',caseId,request:{actionRequestId:'not-approved'}}));
  await assert.rejects(execute('worker','workflow',{stage:'reconcile',eventId:'count-1',inventory:added.inventory}), /server-owned/);
  passed('unapproved action and caller-owned snapshot rejected');
  const reviewed = await execute('reviewer','workflow',{stage:'review',caseId,decision:{decisionId:'decision-1',outcome:'approve',rationale:'Evidence checked',reviewerId:'forged-admin',reviewerName:'Forged',decidedAt:'2000-01-01'}});
  assert.equal(reviewed.caseRecord.review.reviewerId,'reviewer'); assert.equal(reviewed.caseRecord.review.reviewerName,'Trusted reviewer');
  assert.notEqual(reviewed.caseRecord.review.decidedAt,'2000-01-01'); passed('server identity and time replace forged reviewer claims');
  await assert.rejects(store.execute(tokenHash(other.token),'workflow',{requestId:randomUUID(),stage:'review',caseId,decision:{}}));
  const otherState = await store.read(tokenHash(other.token)); assert.equal(otherState.workflow.cases.length,0); assert.equal(otherState.inventory.inventoryItems.length,0);
  await assert.rejects(store.execute(tokenHash(other.token),'workflow',{requestId:randomUUID(),stage:'intake',event:event('cross-item')}));
  passed('cross-tenant case, inventory and foreign item references blocked');
  const actionBody = {requestId:'durable-apply',stage:'action',caseId,request:{actionRequestId:'action-1'}};
  const concurrent = await Promise.all([store.execute(hash('worker'),'workflow',actionBody),store.execute(hash('worker'),'workflow',actionBody)]);
  assert.equal(concurrent.filter(x => x.duplicate).length,1); assert.equal(concurrent[0].inventory.inventoryItems[0].quantityOnHand,5);
  passed('simultaneous duplicate action applies once');
  await assert.rejects(store.execute(hash('worker'),'workflow',{...actionBody,caseId:'different'}),e=>e.statusCode===409);
  passed('idempotency key reuse with different input conflicts');
  const adminEvent = event('admin-case'); adminEvent.observedQuantity=4; adminEvent.evidence[0].observedQuantity=4;
  await execute('worker','workflow',{stage:'intake',event:adminEvent});
  const adminCase = await execute('worker','workflow',{stage:'reconcile',eventId:'admin-case'});
  await execute('admin','workflow',{stage:'review',caseId:adminCase.caseRecord.caseId,decision:{decisionId:'admin-decision',outcome:'approve',rationale:'Synthetic count'}});
  await assert.rejects(execute('admin','workflow',{stage:'action',caseId:adminCase.caseRecord.caseId,request:{actionRequestId:'self-approved'}}),e=>e.statusCode===403);
  passed('admin cannot execute their own approval');
  const before = await store.read(hash('worker'));
  const race = await Promise.allSettled([1,2].map(quantity => execute('worker','inventory',{operation:'receive',expectedRevision:before.revision,itemId,quantity})));
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1); assert.equal(race.filter(r=>r.status==='rejected'&&r.reason.statusCode===409).length,1);
  passed('concurrent stock adjustments: one commit, one stale revision');
  let taskState = await store.read(hash('worker'));
  const moved = await execute('worker','inventory',{operation:'begin',expectedRevision:taskState.revision,itemId,quantity:1});
  const finished = await execute('worker','inventory',{operation:'finish',expectedRevision:moved.revision,taskId:moved.inventory.restockTasks[0].id,outcome:'returned'});
  assert.equal(finished.inventory.inventoryItems[0].quantityOnHand,taskState.inventory.inventoryItems[0].quantityOnHand);
  await assert.rejects(execute('worker','inventory',{operation:'finish',expectedRevision:finished.revision,taskId:moved.inventory.restockTasks[0].id,outcome:'returned'}));
  passed('durable shelf restock/return preserves units and rejects repeat completion');
  await prepare('stale');
  await execute('reviewer','workflow',{stage:'review',caseId:'case:stale',decision:{decisionId:'decision-stale',outcome:'approve',rationale:'Synthetic evidence checked'}});
  let current = await store.read(hash('worker'));
  await execute('worker','inventory',{operation:'receive',expectedRevision:current.revision,itemId,quantity:1});
  await assert.rejects(execute('worker','workflow',{stage:'action',caseId:'case:stale',request:{actionRequestId:'stale-action'}}),/changed since/); passed('approved stale action cannot overwrite stock');
  // Inject a database failure after inventory persistence to prove the entire transaction rolls back.
  await local.owner.query("CREATE FUNCTION lookout.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$");
  await local.owner.query('CREATE TRIGGER test_fail BEFORE INSERT ON lookout.audit FOR EACH ROW EXECUTE FUNCTION lookout.test_fail_audit()');
  current = await store.read(hash('worker'));
  await assert.rejects(execute('worker','inventory',{operation:'receive',expectedRevision:current.revision,itemId,quantity:9}));
  assert.deepEqual(await store.read(hash('worker')),current);
  await local.owner.query('DROP TRIGGER test_fail ON lookout.audit'); passed('audit write failure rolls back stock, revision and idempotency');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('lookout.tenant_id','two',true)");
    assert.equal((await client.query("SELECT * FROM lookout.items WHERE tenant_id='one'")).rowCount,0);
    await assert.rejects(client.query("UPDATE lookout.principals SET role='admin'"),e=>e.code==='42501');
    await client.query('ROLLBACK');
    await assert.rejects(client.query('DELETE FROM lookout.audit'),e=>e.code==='42501');
    await assert.rejects(client.query("UPDATE lookout.audit SET operation='forged'"),e=>e.code==='42501');
    assert.equal((await client.query('SELECT * FROM lookout.items')).rowCount,0);
  } finally { client.release(); }
  passed('RLS hides foreign rows; no pooled tenant leakage; identity/audit writes denied');
  const auditBefore = (await local.owner.query('SELECT count(*)::int AS count FROM lookout.audit')).rows[0].count;
  assert.ok(auditBefore>=10);
  assert.equal((await local.owner.query('SELECT count(*)::int AS count FROM lookout.actions')).rows[0].count,1);
  passed('durable audit, reviews and one action persisted in relational tables');
  await new Promise(resolve=>server.close(resolve)); server=undefined;
  await pool.end(); pool=undefined; await local.owner.end(); await local.db.stop();
  await local.db.start(); pool=createPool(local.runtimeUrl); store=new PostgresStore(pool);
  assert.deepEqual(await store.read(hash('worker')),current);
  const replay = await store.execute(hash('worker'),'workflow',actionBody); assert.equal(replay.duplicate,true); assert.equal(replay.inventory.inventoryItems[0].quantityOnHand,5);
  passed('PostgreSQL restart preserves inventory/workflow; durable retry returns original result');
  local.owner=createPool(`postgresql://postgres:${local.secrets.ownerPassword}@127.0.0.1:${process.env.TEST_DB_PORT??55439}/postgres`);
  await local.owner.query("UPDATE lookout.principals SET disabled=true WHERE tenant_id='one' AND id='worker'");
  await assert.rejects(store.read(hash('worker')),e=>e.statusCode===401);
  await local.owner.query("UPDATE lookout.principals SET expires_at=now()-interval '1 second' WHERE tenant_id='one' AND id='reviewer'");
  await assert.rejects(store.read(hash('reviewer')),e=>e.statusCode===401); passed('revoked and expired identities denied');
  console.log(`${checks} real PostgreSQL integration/security checks passed.`);
} finally {
  if (server) await new Promise(resolve=>server.close(resolve));
  await pool?.end(); await local?.owner.end(); await local?.db.stop(); await rm(dir,{recursive:true,force:true});
}
