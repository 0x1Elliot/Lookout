import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setTimeout as pause} from 'node:timers/promises';
import {localPostgres, provisionTenant, secret} from './lib/local-postgres.mjs';
import {createPool, verifyRuntime, verifyIdentity} from '../server/db/pool.js';
import {createApplication} from '../server/application.js';
import {PostgresStore} from '../server/db/store.js';
import {tokenHash} from '../server/security.js';

// Fault injection ONLY against a new, isolated local cluster. No .env loading.
await mkdir('work', {recursive:true});
const dir=await mkdtemp(resolve('work/pool-recovery-'));
let local, app, server, runtime, identity, blocker;
let checks=0;
const pass=message=>{checks++;console.log('PASS '+message);};
try {
  local=await localPostgres(dir, Number(process.env.TEST_RECOVERY_DB_PORT??55448));
  const a={id:'recovery-a',name:'Synthetic A',role:'admin',token:secret()};
  const b={id:'recovery-b',name:'Synthetic B',role:'admin',token:secret()};
  await provisionTenant(local.owner,'recovery-a',[a]);
  await provisionTenant(local.owner,'recovery-b',[b]);
  const env={NODE_ENV:'production',LOOKOUT_MODE:'secure',LOOKOUT_AUTH:'supabase',
    DATABASE_URL:local.runtimeUrl,AUTH_DATABASE_URL:local.identityUrl,APP_ORIGIN:'https://recovery.example',
    SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
  app=await createApplication(env);
  server=createServer(app.handler);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path='/api/inventory',body,token=a.token) {
    const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:'__Host-lookout_session='+token,
      ...(body?{'Content-Type':'application/json',Origin:env.APP_ORIGIN}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,body:await r.json()};
  }
  async function kill(role) {
    const {rows}=await local.owner.query('SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE usename=$1 AND pid<>pg_backend_pid()',[role]);
    assert.ok(rows.length);assert.ok(rows.every(r=>r.terminated));
  }
  // A request can race the server's termination notification and correctly
  // receive 503. Only this test caller makes a bounded, explicit next request;
  // the application never retries it or reconnects in a background loop.
  async function recovered(path, body) {
    for(let attempt=0;attempt<3;attempt++) {
      const result=await call(path,body);
      if(result.status===200)return result;
      assert.equal(result.status,503);assert.equal(result.body.error,'Database unavailable.');
    }
    throw new Error('Pool failed to recover within three explicit requests');
  }
  async function waiting(role, minimum=1) {
    for(let i=0;i<250;i++) {
      const {rows:[r]}=await local.owner.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",[role]);
      if(r.n>=minimum) return;
      await pause(10);
    }
    throw new Error('Synthetic request did not reach its database lock');
  }
  const request={operation:'add',requestId:'recover-write',expectedRevision:0,item:{name:'Synthetic merchandise',count:8,location:'A'}};
  for(let i=0;i<5;i++) {
    assert.equal((await recovered()).status,200);
    await kill('lookout_app');
    assert.equal((await recovered()).status,200);
    assert.equal((await call('/api/team/invite',{email:`member-${i}@example.test`,role:'worker'})).status,200);
    await kill('lookout_identity_app');
    assert.equal((await recovered('/api/team/invite',{email:`after-${i}@example.test`,role:'worker'})).status,200);
  }
  pass('five idle-disconnect/reconnect cycles for BOTH real restricted application pools; process stays alive');

  blocker=await local.owner.connect();await blocker.query('BEGIN');await blocker.query('LOCK TABLE lookout.audit IN ACCESS EXCLUSIVE MODE');
  const writes=[call('/api/inventory',request),call('/api/inventory',{...request,requestId:'concurrent-loss'})];
  await waiting('lookout_app',2);await kill('lookout_app');
  const failed=await Promise.all(writes);assert.ok(failed.every(r=>r.status===503));
  assert.ok(failed.every(r=>r.body.error==='Database unavailable.'));
  await blocker.query('ROLLBACK');blocker.release();blocker=undefined;
  const unchanged=await call();assert.equal(unchanged.body.revision,0);assert.equal(unchanged.body.inventory.inventoryItems.length,0);
  assert.equal((await local.owner.query("SELECT count(*)::int AS n FROM lookout.requests WHERE id IN ('recover-write','concurrent-loss')")).rows[0].n,0);
  assert.equal((await local.owner.query("SELECT count(*)::int AS n FROM lookout.audit WHERE operation='add'")).rows[0].n,0);
  pass('concurrent runtime losses return controlled 503; inventory, retry ledger and audit roll back together');

  assert.equal((await call('/api/inventory',request)).status,200);
  assert.equal((await call('/api/inventory',request)).body.duplicate,true);
  assert.equal((await call()).body.revision,1);
  pass('explicit same-key retry commits once after rollback; no automatic write replay');

  blocker=await local.owner.connect();await blocker.query('BEGIN');await blocker.query('LOCK TABLE lookout.sessions IN ACCESS EXCLUSIVE MODE');
  const logout=call('/api/auth/logout',{});
  await waiting('lookout_identity_app');await kill('lookout_identity_app');
  assert.equal((await logout).status,503);
  await blocker.query('ROLLBACK');blocker.release();blocker=undefined;
  assert.equal((await call()).status,200);
  assert.equal((await local.owner.query("SELECT count(*)::int AS n FROM lookout.audit WHERE operation='auth.logout'")).rows[0].n,0);
  pass('in-flight identity failure returns 503; failed logout does not falsely revoke session or record success');

  runtime=createPool(local.runtimeUrl);identity=createPool(local.identityUrl);
  const store=new PostgresStore(runtime);
  await assert.rejects(store.transaction(tokenHash(a.token),async c=>{
    await c.query('UPDATE lookout.inventory SET revision=99');
    const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const ended=new Promise(resolve=>c.once('end',resolve));
    await local.owner.query('SELECT pg_terminate_backend($1)',[pid]);
    await ended;
    return 'must never commit';
  }),e=>e.code==='57P01'||e.message==='Connection terminated unexpectedly');
  assert.equal((await call()).body.revision,1);
  pass('checked-out connection failure BETWEEN queries cannot crash or commit an interrupted transaction');

  for(let i=0;i<3;i++) {
    await local.db.stop();
    const down=await Promise.all([call(),call('/api/team/invite',{email:'offline@example.test',role:'worker'})]);
    assert.ok(down.every(r=>r.status===503));
    await local.db.start();
    assert.equal((await call()).status,200);
    assert.equal((await call('/api/inventory',request)).body.duplicate,true);
  }
  pass('three complete database outages: bounded failures, both pools recover, committed retry remains durable');

  await verifyRuntime(runtime);await verifyIdentity(identity);
  const foreign=await call('/api/inventory',{operation:'receive',requestId:'foreign-after-recovery',expectedRevision:1,
    itemId:(await call()).body.inventory.inventoryItems[0].id,quantity:9,tenant_id:'recovery-a',role:'admin'},b.token);
  assert.ok(foreign.status>=400);
  assert.equal((await call(undefined,undefined,b.token)).body.inventory.inventoryItems.length,0);
  assert.equal((await call(undefined,undefined,secret())).status,401);
  const c=await runtime.connect();try {
    await c.query('BEGIN');await c.query("SELECT set_config('lookout.tenant_id','recovery-a',true)");
    assert.equal((await c.query('SELECT * FROM lookout.inventory')).rowCount,0);await c.query('ROLLBACK');
  } finally {c.release();}
  await assert.rejects(runtime.query('SET ROLE lookout_identity'),e=>e.code==='42501');
  await assert.rejects(identity.query('SELECT * FROM lookout.inventory'),e=>e.code==='42501');
  pass('recovered pools preserve authentication, tenant isolation, forced RLS and separated capabilities');

  const held=await runtime.connect();await held.query('BEGIN');
  let finished=false;const end=runtime.end().then(()=>{finished=true;});
  assert.equal(finished,false);await held.query('ROLLBACK');held.release();await end;
  assert.equal(runtime.totalCount,0);await runtime.end();runtime=undefined;
  await Promise.all([app.close(),app.close()]);
  assert.equal((await call()).status,503);
  await identity.end();await identity.end();identity=undefined;
  pass('shutdown drains checked-out clients, rejects new requests, waits for sockets and is idempotent');
  console.log(`${checks} real PostgreSQL recovery groups passed. No hosted database or provider contacted.`);
} finally {
  if(blocker){await blocker.query('ROLLBACK').catch(()=>{});blocker.release();}
  if(server)await new Promise(r=>server.close(r));
  await app?.close();await runtime?.end();await identity?.end();await local?.owner.end();await local?.db.stop();
  await rm(dir,{recursive:true,force:true});
}
