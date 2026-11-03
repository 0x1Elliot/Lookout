// Safe, offline validation of Lookout's production configuration.
// Run with environment loaded by Node: node --env-file=.env scripts/diagnose-production-config.mjs
// Prints only pass/fail/issue names, never connection strings, usernames, hosts or credentials.
import { secureConfig } from '../server/security.js';
import { authConfig } from '../server/auth.js';
const env=process.env;
const checks=[];
function check(name,fn){
  let ok=false;
  try {ok=Boolean(fn());} catch {}
  checks.push({name,ok});
}
const present=k=>typeof env[k]==='string'&&env[k].length>0;
for(const name of ['NODE_ENV','LOOKOUT_MODE','LOOKOUT_AUTH','DATABASE_URL','AUTH_DATABASE_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','APP_ORIGIN']){
  check(name+' present',()=>present(name));
}
check('production mode',()=>env.NODE_ENV==='production');
check('secure mode',()=>env.LOOKOUT_MODE==='secure');
check('supabase auth mode',()=>env.LOOKOUT_AUTH==='supabase');
check('inventory PostgreSQL URL and TLS policy',()=>{secureConfig({DATABASE_URL:env.DATABASE_URL,LOOKOUT_MODE:'secure'});return true;});
check('identity PostgreSQL URL and TLS policy',()=>{secureConfig({DATABASE_URL:env.AUTH_DATABASE_URL,LOOKOUT_MODE:'secure'});return true;});
check('distinct database usernames',()=>{
  if(!present('DATABASE_URL')||!present('AUTH_DATABASE_URL'))return false;
  const a=new URL(env.DATABASE_URL),b=new URL(env.AUTH_DATABASE_URL);
  return Boolean(a.username&&b.username&&a.username!==b.username);
});
check('Supabase origin, application origin and publishable key',()=>{authConfig({...env,LOOKOUT_AUTH:'supabase'});return true;});
for(const c of checks)console.log((c.ok?'PASS':'FAIL')+' '+c.name);
if(checks.some(c=>!c.ok)){console.error('Configuration preflight failed. No secrets printed; no network requests or database writes made.');process.exitCode=1;}
else console.log('All static startup configuration checks passed (no network/database connectivity tested).');
