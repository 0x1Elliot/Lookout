import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { apiFixtures } from './check-agent-api.mjs';
const run=promisify(execFile);
const base=process.argv[2]??'http://127.0.0.1:4174';
const {stdout:config}=await run('curl',['-fsS',base+'/api/config']);
assert.equal(JSON.parse(config).mode,'demo','Run this compatibility check only against explicit demo mode.');
const endpoint=base+'/api/agent/workflow';
await mkdir('work/curl-fixtures',{recursive:true});
let count=0;
async function fixtures() {
  for(const [name,value] of Object.entries(apiFixtures()))await writeFile(`work/curl-fixtures/${name}.json`,JSON.stringify(value));
}
async function check(expected,name,args=[]) {
  const {stdout}=await run('curl',['-sS','-o','/dev/null','-w','%{http_code}',...args,endpoint]);
  assert.equal(Number(stdout),expected,name);count++;console.log(`${expected} ${name}`);
}
const post=name=>['-H','Content-Type: application/json','--data-binary',`@work/curl-fixtures/${name}.json`];
await fixtures();
await check(200,'read workflow');
await check(400,'malformed JSON',['-H','Content-Type: application/json','--data-binary','{']);
await check(415,'invalid media',['-H','Content-Type: text/plain','--data','{}']);
for(const [name,status] of [['forged-action',400],['intake',200],['reconcile',200],['action',403],['unsupported-outcome',400],['unknown-intake',200],['unknown-reconcile',200],['unsupported-approval',400],['review',200],['stale-action',409],['action',200],['action',200],['new-action',409]])await check(status,name,post(name));
await fixtures();
for(const [name,status] of [['intake',200],['reconcile',200],['reject',200],['action',403]])await check(status,name,post(name));
console.log(`All ${count} documented legacy curl requests passed.`);
