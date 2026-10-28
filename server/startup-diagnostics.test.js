import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeploymentHandler} from './deployment.js';
import {startupFailure} from './startup-diagnostics.js';
import {createApplication} from './application.js';

test('startup diagnostics distinguish failure classes without logging private exception fields', async () => {
  const env={NODE_ENV:'production',LOOKOUT_MODE:'secure',LOOKOUT_AUTH:'supabase'};
  const privateText='postgresql://private-user:private-password@private-host/db?token=private-token';
  for (const [error,category] of [
    [startupFailure('configuration_missing'), 'configuration_missing'],
    [startupFailure('configuration_invalid',new Error(privateText)), 'configuration_invalid'],
    [Object.assign(new Error(privateText),{code:'28P01',detail:privateText}), 'database_authentication'],
    [Object.assign(new Error(privateText),{code:'ERR_TLS_CERT_ALTNAME_INVALID',host:privateText}), 'database_tls'],
    [Object.assign(new Error(privateText),{code:'ENOENT',path:privateText}), 'database_tls'],
    [Object.assign(new Error(privateText),{code:'42501',query:privateText}), 'database_initialization'],
    [Object.assign(new Error(privateText),{startupCategory:privateText}), 'database_initialization'],
  ]) {
    const logs=[];
    const handle=createDeploymentHandler({env,initialize:async()=>{throw error;},log:(...args)=>logs.push(args)});
    const response=await handle(new Request('https://app.example/api/config'));
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:'Application configuration unavailable.'});
    assert.deepEqual(logs,[['Lookout startup failed.',{code:category}]]);
    assert.ok(!JSON.stringify(logs).includes(privateText));
  }
});

test('missing config fails closed before database access and retry can recover',async()=>{
  const logs=[];const env={NODE_ENV:'production',LOOKOUT_MODE:'secure',LOOKOUT_AUTH:'supabase'};
  let calls=0;
  const handle=createDeploymentHandler({env,log:(...v)=>logs.push(v),initialize:async()=>{
    calls++;if(calls===1)return createApplication(env);
    return {handler(_req,res){res.writeHead(200);res.end('{"mode":"secure"}');}};
  }});
  assert.equal((await handle(new Request('https://app.example/api/config'))).status,503);
  assert.equal(logs[0][1].code,'configuration_missing');
  assert.equal((await handle(new Request('https://app.example/api/config'))).status,200);
  assert.equal((await handle(new Request('https://app.example/api/config'))).status,200);
  assert.equal(calls,2);
});

test('a failed diagnostic logger cannot expose the initialization error or change the response',async()=>{
  const handle=createDeploymentHandler({env:{},log:()=>{throw Error('private log failure');}});
  const response=await handle(new Request('https://app.example/api/config'));
  assert.equal(response.status,503);assert.equal(await response.text(),'{"error":"Application configuration unavailable."}');
});
