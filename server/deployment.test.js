import test from 'node:test';import assert from 'node:assert/strict';
import {createDeploymentHandler} from './deployment.js';
const env={NODE_ENV:'production',LOOKOUT_MODE:'secure',LOOKOUT_AUTH:'supabase'};
test('deployment refuses development mode and redacts initialization failures',async()=>{
 let calls=0;const rejected=createDeploymentHandler({env:{},initialize:async()=>{calls++;}});
 assert.equal((await rejected(new Request('https://app.example/api/config'))).status,503);assert.equal(calls,0);
 const failure=createDeploymentHandler({env,initialize:async()=>{throw Error('private connection secret');}});
 const result=await failure(new Request('https://app.example/api/config'));assert.equal(result.status,503);assert.ok(!(await result.text()).includes('private'));
});
test('deployment streams request bodies and preserves method, route and secure response headers',async()=>{
 let calls=0;const handler=createDeploymentHandler({env,initialize:async()=>{calls++;return {async handler(req,res){let body='';for await(const chunk of req)body+=chunk;res.setHeader('Set-Cookie','__Host-lookout_session=fixture; Secure; HttpOnly');res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({url:req.url,method:req.method,body}));}};}});
 const response=await handler(new Request('https://app.example/api?route=inventory',{method:'POST',body:'{"requestId":"fixture"}',headers:{'Content-Type':'application/json'}}));
 assert.deepEqual(await response.json(),{url:'/api/inventory',method:'POST',body:'{"requestId":"fixture"}'});assert.match(response.headers.get('set-cookie'),/Secure; HttpOnly/);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await handler(new Request('https://app.example/api?route=../secret'))).status,404);
 assert.equal((await handler(new Request('https://app.example/.env'))).status,404);assert.equal(calls,1);
});
test('forwarded client addresses are used only inside the trusted Vercel environment',async()=>{
 const seen=[];
 const initialize=async()=>({handler(req,res){seen.push(req.socket.remoteAddress);res.end('{}');}});
 const request=()=>new Request('https://app.example/api/config',{headers:{'x-vercel-forwarded-for':'192.0.2.1'}});
 await createDeploymentHandler({env,initialize})(request());
 await createDeploymentHandler({env:{...env,VERCEL:'1'},initialize})(request());
 assert.deepEqual(seen,['deployment','192.0.2.1']);
});
