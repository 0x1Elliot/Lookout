import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountAuth, authConfig, sessionCookie, sessionHash, validateLogin } from './auth.js';
const local = { LOOKOUT_AUTH:'local-dev', DATABASE_URL:'postgres://localhost/test' };
test('normal login configuration never silently enables local auth in production', () => {
  assert.throws(()=>authConfig({DATABASE_URL:'postgres://localhost/test'}),/SUPABASE/);
  assert.throws(()=>authConfig({...local,NODE_ENV:'production'}),/forbidden/);
  assert.throws(()=>authConfig({...local,DATABASE_URL:'postgres://remote.example/test'}),/local database/);
  assert.throws(()=>authConfig({...local,APP_ORIGIN:'https://remote.example'}),/loopback/);
  const settings={APP_ORIGIN:'https://lookout.example',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_unit_test'};
  assert.equal(authConfig(settings).secure,true);
  assert.throws(()=>authConfig({...settings,SUPABASE_PUBLISHABLE_KEY:'sb_secret_test'}),/never a secret/);
  assert.throws(()=>authConfig({...settings,APP_ORIGIN:'http://lookout.example'}),/HTTPS/);
});
test('login input, HttpOnly host cookie and rate/concurrency limits', () => {
  assert.throws(()=>validateLogin({email:'a',password:'short'}));
  assert.throws(()=>validateLogin({email:'a@example.test',password:'short'}));
  const cookie=sessionCookie('a'.repeat(43),true);
  assert.match(cookie,/__Host-lookout_session=.*HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure/);
  assert.equal(sessionHash({cookie},true).length,64);
  assert.throws(()=>sessionHash({cookie:'lookout_session='+'a'.repeat(43)},true));
  const auth=new AccountAuth({},{}); for(let i=0;i<15;i++)auth.limit('127.0.0.1');
  assert.throws(()=>auth.limit('127.0.0.1'),error=>error.statusCode===429);
  auth.inflight=4; assert.throws(()=>auth.limit('different'),error=>error.statusCode===429);
});
test('managed email login validates provider identity and ignores user role/tenant metadata', async () => {
  const calls=[];
  const pool={async query(sql,args) {calls.push({sql,args});return {rows:[{id:'verified-account'}]};}};
  const fetcher=async url=>({ok:true,async json(){return url.endsWith('/user')
    ? {id:'verified-subject',email:'person@example.test',email_confirmed_at:'2026-10-25',user_metadata:{role:'admin',tenant_id:'victim'}}
    : url.endsWith('/settings') ? {external:{email:true},mailer_autoconfirm:false} : {access_token:'provider-test-fixture',expires_in:3600};}});
  const auth=new AccountAuth(pool,{provider:'supabase',url:'https://project.supabase.co',key:'sb_publishable_unit_test'},fetcher);
  const token=await auth.login({email:'person@example.test',password:'test-password-only'});
  assert.equal(token.length,43); assert.deepEqual(calls[0].args,['supabase','verified-subject','person@example.test','person@example.test',null]);
  assert.equal(calls[1].args[0],'verified-account'); assert.equal(calls[1].args[1].length,64);
  assert.match(calls[1].sql,/start_supabase_session/); assert.ok(calls[1].args[2] <= 3600 && calls[1].args[2] > 3590);
});
test('managed identity without verified email cannot create a local session', async () => {
  let queries=0;
  const auth=new AccountAuth({query(){queries++;}}, {provider:'supabase',url:'https://project.supabase.co',key:'sb_publishable_unit_test'},
    async url=>({ok:true,json:async()=>url.endsWith('/user')?{id:'subject',email:'person@example.test'}:url.endsWith('/settings')?{external:{email:true},mailer_autoconfirm:false}:{access_token:'fixture',expires_in:3600}}));
  await assert.rejects(auth.login({email:'person@example.test',password:'test-password-only'}),error=>error.statusCode===401);
  assert.equal(queries,0);
});

test('managed auth fails closed for malformed sessions, provider failures and disabled email verification', async () => {
  const config={provider:'supabase',url:'https://project.supabase.co',key:'sb_publishable_unit_test'};
  const input={email:'person@example.test',password:'test-password-only',name:'Person'};
  let queries=0;
  for (const session of [{}, {access_token:''}, {access_token:'fixture'}, {access_token:'fixture',expires_in:-1}, {access_token:'fixture',expires_in:'3600'}]) {
    const auth=new AccountAuth({query(){queries++;}},config,async url=>({ok:true,json:async()=>url.endsWith('/settings')?{external:{email:true},mailer_autoconfirm:false}:session}));
    await assert.rejects(auth.login(input),e=>e.statusCode===503);
  }
  assert.equal(queries,0);
  for (const settings of [{external:{email:true},mailer_autoconfirm:true},{external:{email:false},mailer_autoconfirm:false},{}]) {
    let calls=0;
    const auth=new AccountAuth({},config,async()=>{calls++;return {ok:true,json:async()=>settings};});
    await assert.rejects(auth.signup(input),e=>e.statusCode===503);
    await assert.rejects(auth.login(input),e=>e.statusCode===503);
    assert.equal(calls,2); // Settings only: no account creation or password exchange.
  }
  for (const [response,status] of [
    [{ok:false,status:500},503],[{ok:false,status:429},429],[{ok:false,status:400},401],
    [{ok:true,json:async()=>{throw new Error('private response');}},503],
    [{ok:true,json:async()=>null},503], [{ok:true,json:async()=>[]},503],
  ]) {
    const auth=new AccountAuth({},config,async()=>response);
    await assert.rejects(auth.provider('user'),e=>e.statusCode===status && !e.message.includes('private'));
  }
  await assert.rejects(new AccountAuth({},config,async()=>{throw new Error('private URL');}).provider('user'),e=>e.statusCode===503 && !e.message.includes('private'));
});
