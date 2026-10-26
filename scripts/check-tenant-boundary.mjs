import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';import {resolve} from 'node:path';import {createServer} from 'node:http';
import {localPostgres,provisionTenant,secret} from './lib/local-postgres.mjs';
import {createPool,verifyRuntime,verifyIdentity} from '../server/db/pool.js';import {PostgresStore} from '../server/db/store.js';import {AccountAuth} from '../server/auth.js';import {createSecureHandler} from '../server/secure-handler.js';import {tokenHash} from '../server/security.js';
await mkdir('work',{recursive:true});const dir=await mkdtemp(resolve('work/tenant-boundary-'));
let local,pool,identity,server,checks=0;const pass=m=>{checks++;console.log('PASS '+m);};
try{
 local=await localPostgres(dir,Number(process.env.TEST_TENANT_DB_PORT??55442));pool=createPool(local.runtimeUrl);identity=createPool(local.identityUrl);
 await verifyRuntime(pool);await verifyIdentity(identity);await assert.rejects(verifyIdentity(pool));await assert.rejects(verifyRuntime(identity));
 const a={id:'owner-a',name:'Owner A',role:'admin',token:secret()},b={id:'owner-b',name:'Owner B',role:'admin',token:secret()};
 await provisionTenant(local.owner,'tenant-a',[a]);await provisionTenant(local.owner,'tenant-b',[b]);
 const store=new PostgresStore(pool);
 const add=(who,name)=>store.execute(tokenHash(who.token),'inventory',{requestId:'initial',operation:'add',expectedRevision:0,item:{name,count:8,location:'A'}});
 const first=await add(a,'A private item'),second=await add(b,'B private item');const bItem=second.inventory.inventoryItems[0].id;
 pass('separate restricted identity/inventory roles and independently seeded session workspaces');
 for(const table of ['principals','auth_accounts','sessions','invitations'])await assert.rejects(pool.query(`SELECT * FROM lookout.${table}`),e=>e.code==='42501');
 await assert.rejects(pool.query('SELECT lookout.start_session($1,$2)',['tenant-b:'+b.id,'f'.repeat(64)]),e=>e.code==='42501');
 await assert.rejects(pool.query('SELECT lookout.register_account($1,$2,$3,$4,$5)',['supabase','forged','fake@example.test','Forged',null]),e=>e.code==='42501');
 await assert.rejects(identity.query('SELECT * FROM lookout.inventory'),e=>e.code==='42501');
 await assert.rejects(pool.query('SET ROLE lookout_identity'),e=>e.code==='42501');
 await assert.rejects(pool.query('SET ROLE postgres'),e=>e.code==='42501');
 await assert.rejects(identity.query('SET ROLE lookout_runtime'),e=>e.code==='42501');
 const bypass=await pool.connect();try{await bypass.query('BEGIN');await bypass.query('SET LOCAL row_security=off');await assert.rejects(bypass.query('SELECT * FROM lookout.items'),e=>e.code==='42501');await bypass.query('ROLLBACK');}finally{bypass.release();}
 pass('inventory credential cannot discover principals, read auth tables or mint identities/sessions; identity cannot read inventory');
 const c=await pool.connect();try{
  await c.query('BEGIN');await c.query("SELECT set_config('lookout.tenant_id','tenant-b',true)");assert.equal((await c.query('SELECT * FROM lookout.items')).rowCount,0);
  await c.query("SELECT set_config('lookout.session_hash',$1,true)",[tokenHash(a.token)]);
  assert.deepEqual((await c.query('SELECT tenant_id FROM lookout.items')).rows,[{tenant_id:'tenant-a'}]);
  assert.equal((await c.query("UPDATE lookout.items SET quantity=999 WHERE tenant_id='tenant-b'")).rowCount,0);
  await assert.rejects(c.query("INSERT INTO lookout.locations(tenant_id,id,name) VALUES('tenant-b','forged','forged')"),e=>e.code==='42501');
  await c.query('ROLLBACK');
  assert.equal((await c.query('SELECT * FROM lookout.items')).rowCount,0);
 }finally{c.release();}
 assert.equal((await store.read(tokenHash(b.token))).inventory.inventoryItems[0].quantityOnHand,8);
 pass('manipulating the old tenant setting cannot replace session authority; foreign reads/writes denied and pooled context cleared');
 const origin='https://test.example';server=createServer(createSecureHandler(store,(_req,res)=>res.writeHead(404).end(),new AccountAuth(identity,{provider:'supabase',secure:true,origin})));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 async function call(path,input,token=a.token){const response=await fetch(base+path,{method:input?'POST':'GET',headers:{Cookie:'__Host-lookout_session='+token,Authorization:'Bearer '+b.token,'X-Tenant-Id':'tenant-b',...(input?{'Content-Type':'application/json',Origin:origin}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:response.status,body:await response.json()};}
 const read=await call('/api/inventory?tenant_id=tenant-b&role=admin');assert.equal(read.status,200);assert.equal(read.body.identity.id,a.id);assert.ok(!JSON.stringify(read.body).includes('B private item'));
 const forgedAdd=await call('/api/inventory',{requestId:'forged-body',operation:'add',expectedRevision:1,tenant_id:'tenant-b',tenantId:'tenant-b',actor_id:b.id,role:'admin',item:{name:'A second item',count:1,location:'A'}});assert.equal(forgedAdd.status,200);
 assert.equal((await store.read(tokenHash(b.token))).inventory.inventoryItems.length,1);
 const wrongItem=await call('/api/inventory',{requestId:'foreign-item',operation:'receive',expectedRevision:2,itemId:bItem,quantity:5,tenant_id:'tenant-b'});assert.ok(wrongItem.status>=400);
 assert.equal((await store.read(tokenHash(b.token))).inventory.inventoryItems[0].quantityOnHand,8);
 pass('real authenticated HTTP ignores forged tenant/user/role/query/header claims and rejects another tenant’s item');
 const wrongCase=await call('/api/agent/workflow',{requestId:'foreign-case',stage:'review',caseId:'case:outside',tenant_id:'tenant-b',decision:{decisionId:'fake',reviewerId:b.id,outcome:'approve',rationale:'Forged'}});assert.ok(wrongCase.status>=400);
 const invalid=await call('/api/inventory',undefined,secret());assert.equal(invalid.status,401);
 pass('manipulated case/identity requests and invalid session cookies fail closed');
 for(const sql of ["UPDATE lookout.audit SET operation='forged'","DELETE FROM lookout.audit","UPDATE lookout.principals SET role='admin'"])await assert.rejects(pool.query(sql),e=>e.code==='42501');
 pass('audit history and principal modification remain forbidden');
 await identity.query('SELECT lookout.end_session($1)',[tokenHash(a.token)]);
 const revoked=await call('/api/inventory');assert.equal(revoked.status,401);
 const cc=await pool.connect();try{await cc.query('BEGIN');await cc.query("SELECT set_config('lookout.session_hash',$1,true)",[tokenHash(a.token)]);await cc.query("SELECT set_config('lookout.tenant_id','tenant-b',true)");assert.equal((await cc.query('SELECT * FROM lookout.items')).rowCount,0);await cc.query('ROLLBACK');}finally{cc.release();}
 pass('revoked session cannot establish tenant context even with a forged tenant setting');
 console.log(`${checks} real PostgreSQL session-bound authorization groups passed.`);
}finally{if(server)await new Promise(r=>server.close(r));await pool?.end();await identity?.end();await local?.owner.end();await local?.db.stop();await rm(dir,{recursive:true,force:true});}
