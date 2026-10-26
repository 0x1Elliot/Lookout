import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { localPostgres } from './lib/local-postgres.mjs';
import { createPool, verifyRuntime } from '../server/db/pool.js';
import { PostgresStore } from '../server/db/store.js';
import { AccountAuth } from '../server/auth.js';
import { createSecureHandler } from '../server/secure-handler.js';

// Real HTTP + real PostgreSQL, simulated Supabase only. Never contacts hosted Auth.
await mkdir('work', {recursive:true});
const directory = await mkdtemp(resolve('work/supabase-test-'));
let local, pool, identityPool, server, checks = 0;
const passed = message => { checks++; console.log('PASS '+message); };
const origin = 'https://lookout.example';
const input = {email:'owner@example.test',password:'Synthetic-password-123',name:'Owner'};
let confirmed = false, outage = false;
const providerCalls = [];
const fetcher = async (url, options) => {
  providerCalls.push({url,options});
  if (outage) return {ok:false,status:503};
  let value;
  if (url.endsWith('/settings')) value = {external:{email:true},mailer_autoconfirm:false};
  else if (url.endsWith('/signup')) value = {id:'provider-subject'};
  else if (url.includes('/token?')) value = {access_token:'synthetic-provider-token',expires_in:3600};
  else {
    assert.equal(options.headers.Authorization,'Bearer synthetic-provider-token');
    value = {id:'provider-subject',email:input.email,email_confirmed_at:confirmed?'2026-10-26T12:00:00Z':null,
      user_metadata:{tenant_id:'victim',role:'reviewer'}};
  }
  return {ok:true,json:async()=>value};
};
try {
  local = await localPostgres(directory,Number(process.env.TEST_SUPABASE_DB_PORT??55441));
  pool = createPool(local.runtimeUrl);
  await verifyRuntime(pool);
  identityPool=createPool(local.identityUrl);
  const auth = new AccountAuth(identityPool,{provider:'supabase',secure:true,origin,url:'https://project.supabase.co',key:'sb_publishable_fixture'},fetcher);
  server = createServer(createSecureHandler(new PostgresStore(pool),(_req,res)=>res.writeHead(404).end(),auth));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  async function call(path,body,cookie) {
    const response = await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:origin}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
  }
  assert.equal((await call('/api/auth/signup',input)).status,200);
  assert.equal((await local.owner.query('SELECT count(*)::int AS n FROM lookout.auth_accounts')).rows[0].n,0);
  assert.equal((await call('/api/auth/login',input)).status,401);
  assert.equal((await local.owner.query('SELECT count(*)::int AS n FROM lookout.sessions')).rows[0].n,0);
  passed('signup delegates to provider; unconfirmed email cannot create account/session');
  confirmed = true;
  const login = await call('/api/auth/login',input);
  assert.equal(login.status,200); assert.match(login.cookie,/__Host-lookout_session=.*HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure/);
  const cookie = login.cookie.split(';')[0];
  let state = await call('/api/inventory',undefined,cookie);
  assert.equal(state.status,200); assert.equal(state.body.identity.role,'admin');
  const {rows:[account]} = await local.owner.query('SELECT * FROM lookout.auth_accounts');
  assert.equal(account.subject,'provider-subject'); assert.notEqual(account.tenant_id,'victim'); assert.equal(account.password_digest,null);
  const {rows:[session]} = await local.owner.query('SELECT extract(epoch FROM (expires_at-now()))::int AS seconds FROM lookout.sessions');
  assert.ok(session.seconds>3500 && session.seconds<=3600);
  passed('verified provider subject binds isolated workspace; no provider password/token stored; session bounded to token lifetime');
  const add = {operation:'add',requestId:'supabase-demo-add',expectedRevision:0,item:{name:'Synthetic notebook',count:8,location:'A'}};
  const pair = await Promise.all([call('/api/inventory',add,cookie),call('/api/inventory',add,cookie)]);
  assert.ok(pair.every(result=>result.status===200)); assert.equal(pair.filter(result=>result.body.duplicate).length,1);
  state = await call('/api/inventory',undefined,cookie);
  assert.equal(state.body.revision,1); assert.equal(state.body.inventory.inventoryItems[0].quantityOnHand,8);
  assert.equal((await call('/api/inventory',{...add,item:{...add.item,count:9}},cookie)).status,409);
  passed('verified login demo: concurrent duplicate inventory add commits once; changed key reuse conflicts');
  const itemId=state.body.inventory.inventoryItems[0].id;
  const race = await Promise.all([1,2].map(quantity=>call('/api/inventory',{operation:'receive',requestId:'receive-'+quantity,expectedRevision:1,itemId,quantity},cookie)));
  assert.deepEqual(race.map(result=>result.status).sort(),[200,409]);
  passed('verified login concurrent stock writes reject stale revision');
  outage=true;
  assert.equal((await call('/api/auth/login',input)).status,503);
  assert.equal((await call('/api/inventory',undefined,cookie)).status,200);
  outage=false;
  await call('/api/auth/login',input);
  assert.equal((await local.owner.query('SELECT count(*)::int AS n FROM lookout.auth_accounts')).rows[0].n,1);
  passed('provider outage denies new login; existing bounded session works; repeated login retains one account');
  await pool.end(); pool=undefined; await identityPool.end(); identityPool=undefined; await local.owner.end(); await local.db.stop(); await local.db.start();
  pool=createPool(local.runtimeUrl); identityPool=createPool(local.identityUrl); auth.pool=identityPool;
  // Handler store must use the new pool after a real database restart.
  await new Promise(resolve=>server.close(resolve)); server=undefined;
  server=createServer(createSecureHandler(new PostgresStore(pool),(_req,res)=>res.writeHead(404).end(),auth));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  local.owner=createPool(`postgresql://postgres:${local.secrets.ownerPassword}@127.0.0.1:${process.env.TEST_SUPABASE_DB_PORT??55441}/postgres`);
  assert.equal((await call('/api/inventory',undefined,cookie)).body.revision,2);
  assert.equal((await call('/api/inventory',add,cookie)).body.duplicate,true);
  passed('database restart preserves Supabase-bound session, inventory and durable retry');
  await local.owner.query('UPDATE lookout.principals SET disabled=true WHERE id=$1',[account.principal_id]);
  assert.equal((await call('/api/inventory',undefined,cookie)).status,401);
  await local.owner.query('UPDATE lookout.principals SET disabled=false WHERE id=$1',[account.principal_id]);
  await local.owner.query("UPDATE lookout.sessions SET expires_at=now()-interval '1 second'");
  assert.equal((await call('/api/inventory',undefined,cookie)).status,401);
  passed('principal disablement and session expiry checked on every request');
  const again = await call('/api/auth/login',input);
  const fresh = again.cookie.split(';')[0];
  assert.equal((await call('/api/auth/logout',{},fresh)).status,200);
  assert.equal((await call('/api/inventory',undefined,fresh)).status,401);
  assert.equal((await local.owner.query("SELECT count(*)::int AS n FROM lookout.audit WHERE operation IN ('auth.login','auth.logout')")).rows[0].n,4);
  await assert.rejects(pool.query('SELECT * FROM lookout.sessions'),error=>error.code==='42501');
  await assert.rejects(pool.query('SELECT lookout.start_supabase_session($1,$2,$3)',[account.id,'a'.repeat(64),28801]));
  passed('logout audit and runtime restrictions hold; excessive session lifetime denied');
  assert.ok(providerCalls.every(call=>!call.options.headers.apikey.startsWith('sb_secret_')));
  console.log(`${checks} simulated-Supabase / real-PostgreSQL integration checks passed. Hosted Supabase and email delivery NOT tested.`);
} finally {
  if(server) await new Promise(resolve=>server.close(resolve));
  await pool?.end(); await identityPool?.end(); await local?.owner.end(); await local?.db.stop(); await rm(directory,{recursive:true,force:true});
}
