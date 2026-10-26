import assert from 'node:assert/strict';import {mkdtemp,mkdir,rm} from 'node:fs/promises';import {resolve} from 'node:path';
import {localPostgres,provisionTenant,secret} from './lib/local-postgres.mjs';import {createDeploymentHandler} from '../server/deployment.js';import {createApplication} from '../server/application.js';
await mkdir('work',{recursive:true});const dir=await mkdtemp(resolve('work/deployment-test-'));let local,app;
try{
 local=await localPostgres(dir,Number(process.env.TEST_DEPLOY_DB_PORT??55443));
 const user={id:'deployment-owner',name:'Deployment owner',role:'admin',token:secret()},reviewer={id:'deployment-reviewer',name:'Deployment reviewer',role:'reviewer',token:secret()};await provisionTenant(local.owner,'deployment-workspace',[user,reviewer]);
 const env={NODE_ENV:'production',LOOKOUT_MODE:'secure',LOOKOUT_AUTH:'supabase',DATABASE_URL:local.runtimeUrl,AUTH_DATABASE_URL:local.identityUrl,APP_ORIGIN:'https://lookout.example',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
 let starts=0;const handle=createDeploymentHandler({env,initialize:async e=>{starts++;app=await createApplication(e);return app;}});
 const call=(route,input,token=user.token,origin=env.APP_ORIGIN)=>handle(new Request(`https://lookout.example/api?route=${route}`,{method:input?'POST':'GET',headers:{Cookie:'__Host-lookout_session='+token,...(input?{'Content-Type':'application/json',Origin:origin}:{})},...(input?{body:JSON.stringify(input)}:{})}));
 assert.equal((await call('config')).status,200);assert.equal((await call('inventory',undefined,secret())).status,401);
 const body={requestId:'web-adapter-add',operation:'add',expectedRevision:0,item:{name:'Real adapter inventory',count:8,location:'A'}};
 const add=await call('inventory',body);assert.equal(add.status,200);assert.equal((await add.json()).revision,1);
 const replay=await call('inventory',body);assert.equal((await replay.json()).duplicate,true);
 const state=await call('inventory');assert.equal((await state.json()).inventory.inventoryItems[0].quantityOnHand,8);
 assert.equal((await call('inventory',{...body,requestId:'forged-origin'},user.token,'https://attacker.invalid')).status,403);
 assert.equal((await call('inventory',{...body,requestId:'stale',expectedRevision:0})).status,409);
 const current=await (await call('inventory')).json(),itemId=current.inventory.inventoryItems[0].id,at=new Date().toISOString();
 const event={eventId:'adapter-count',occurredAt:at,source:'synthetic/adapter',type:'inventory-count-observed',itemId,observedQuantity:5,evidence:[{id:'adapter-sheet',kind:'manual-count-sheet',description:'Synthetic five',observedAt:at,observedQuantity:5}]};
 assert.equal((await call('agent/workflow',{requestId:'adapter-intake',stage:'intake',event})).status,200);
 const reconciliation=await (await call('agent/workflow',{requestId:'adapter-reconcile',stage:'reconcile',eventId:event.eventId})).json();const caseId=reconciliation.caseRecord.caseId;
 assert.equal((await call('agent/workflow',{requestId:'adapter-review',stage:'review',caseId,decision:{decisionId:'adapter-decision',outcome:'approve',rationale:'Synthetic count checked'}},reviewer.token)).status,200);
 const action={requestId:'adapter-apply',stage:'action',caseId,request:{actionRequestId:'adapter-action'}};
 const applied=await (await call('agent/workflow',action)).json();assert.equal(applied.inventory.inventoryItems[0].quantityOnHand,5);
 const repeated=await (await call('agent/workflow',action)).json();assert.equal(repeated.duplicate,true);
 const oversized=await handle(new Request('https://lookout.example/api?route=auth/signup',{method:'POST',headers:{'Content-Type':'application/json',Origin:env.APP_ORIGIN},body:JSON.stringify({email:'a@example.test',password:'x'.repeat(17000)})}));assert.equal(oversized.status,413);
 assert.equal(starts,1);
 console.log('PASS production Web/Node adapter: actual restricted PostgreSQL, authenticated inventory write/read, durable retry, stale conflict, origin/size rejection, four-stage independent review/action and reused initialization. No provider authentication simulated or invoked.');
}finally{await app?.close();await local?.owner.end();await local?.db.stop();await rm(dir,{recursive:true,force:true});}
