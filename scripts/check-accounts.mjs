import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { localPostgres } from './lib/local-postgres.mjs';
import { createPool } from '../server/db/pool.js';
import { PostgresStore } from '../server/db/store.js';
import { AccountAuth } from '../server/auth.js';
import { createSecureHandler } from '../server/secure-handler.js';
await mkdir('work',{recursive:true});
const dir=await mkdtemp(resolve('work/accounts-'));
let local,pool,server; let checks=0;
const passed=message=>{checks++;console.log('PASS '+message);};
try {
  local=await localPostgres(dir,Number(process.env.TEST_AUTH_DB_PORT??55440)); pool=createPool(local.runtimeUrl);
  const auth=new AccountAuth(pool,{provider:'local-dev',origin:'http://127.0.0.1:4173',secure:false});
  server=createServer(createSecureHandler(new PostgresStore(pool),(_req,res)=>res.writeHead(404).end(),auth));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,input,cookie,origin='http://127.0.0.1:4173') {
    const response=await fetch(base+path,{method:input?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(input?{'Content-Type':'application/json',Origin:origin}:{})},...(input?{body:JSON.stringify(input)}:{})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],rawCookie:response.headers.get('set-cookie')};
  }
  const admin={email:'owner@example.test',password:'Local-test-password-123',name:'Workspace owner',role:'reviewer',tenant_id:'forged'};
  assert.equal((await call('/api/auth/signup',admin)).status,200);
  const login=await call('/api/auth/login',admin); assert.equal(login.status,200); assert.match(login.rawCookie,/HttpOnly; SameSite=Strict/);
  let cookie=login.cookie;
  const state=await call('/api/inventory',undefined,cookie); assert.equal(state.status,200); assert.equal(state.body.identity.role,'admin');
  assert.equal(state.body.identity.name,'Workspace owner'); passed('email signup/login creates its own workspace with server-selected role');
  const stored=(await local.owner.query("SELECT password_digest FROM lookout.auth_accounts WHERE email='owner@example.test'")).rows[0].password_digest;
  assert.ok(!stored.includes(admin.password)); assert.match(stored,/^[a-f0-9]{32}:[a-f0-9]{128}$/); passed('development passwords salted and scrypt-hashed; session is HttpOnly');
  assert.equal((await call('/api/auth/signup',{...admin,password:'different-password-123'})).status,200);
  assert.equal((await call('/api/auth/login',{...admin,password:'different-password-123'})).status,401);
  assert.equal((await call('/api/auth/login',admin)).status,200); passed('duplicate signup cannot replace an existing password');
  assert.equal((await call('/api/team/invite',{email:'reviewer@example.test',role:'reviewer'},cookie,'https://attacker.example')).status,403);
  assert.equal((await call('/api/auth/logout',{},cookie,'')).status,403); passed('cookie mutations reject missing/foreign Origin (CSRF)');
  assert.equal((await call('/api/team/invite',{email:'reviewer@example.test',role:'reviewer'},cookie)).status,200);
  assert.equal((await call('/api/team/invite',{email:'worker@example.test',role:'worker'},cookie)).status,200);
  async function join(email) {
    const user={email,password:'Local-test-password-456',name:email};
    assert.equal((await call('/api/auth/signup',user)).status,200);
    const session=await call('/api/auth/login',user); assert.equal(session.status,200);return session.cookie;
  }
  const reviewer=await join('reviewer@example.test'); const worker=await join('worker@example.test');
  const r=await call('/api/inventory',undefined,reviewer);const w=await call('/api/inventory',undefined,worker);
  assert.equal(r.body.identity.role,'reviewer'); assert.equal(w.body.identity.role,'worker');
  const records=(await local.owner.query('SELECT DISTINCT tenant_id FROM lookout.auth_accounts')).rows;
  assert.equal(records.length,1); passed('admin-prepared email invitations grant only their recorded workspace and role');
  assert.equal((await call('/api/team/invite',{email:'evil@example.test',role:'reviewer'},worker)).status,403);
  assert.equal((await call('/api/agent/workflow',{stage:'review',requestId:'forged',caseId:'none',decision:{}},worker)).status,403);
  assert.equal((await call('/api/inventory',{operation:'add',requestId:'forged',expectedRevision:0,item:{name:'x',count:1,location:'x'}},reviewer)).status,403);
  passed('normal user sessions enforce worker/reviewer/admin RBAC');
  const added=await call('/api/inventory',{operation:'add',requestId:'normal-login-item',expectedRevision:0,item:{name:'Synthetic account test',count:8,location:'A'}},worker);
  assert.equal(added.status,200);
  const outsider=await join('outsider@example.test'); assert.equal((await call('/api/inventory',undefined,outsider)).body.inventory.inventoryItems.length,0);
  passed('public signup never joins an existing tenant without an invitation');
  assert.equal((await call('/api/auth/logout',{},cookie)).status,200);
  assert.equal((await call('/api/inventory',undefined,cookie)).status,401); passed('logout revokes the database session');
  const again=await call('/api/auth/login',admin);cookie=again.cookie;
  await local.owner.query("UPDATE lookout.sessions SET expires_at=now()-interval '1 second' WHERE token_hash=encode(sha256($1::bytea),'hex')",[cookie.split('=')[1]]);
  assert.equal((await call('/api/inventory',undefined,cookie)).status,401);passed('expired user sessions are denied');
  auth.attempts.clear();
  await assert.rejects(pool.query('SELECT * FROM lookout.auth_accounts'),e=>e.code==='42501');
  await assert.rejects(pool.query('SELECT * FROM lookout.sessions'),e=>e.code==='42501');passed('runtime cannot read password hashes or raw session records directly');
  console.log(`${checks} real PostgreSQL account/session checks passed.`);
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));await pool?.end();await local?.owner.end();await local?.db.stop();await rm(dir,{recursive:true,force:true});
}
