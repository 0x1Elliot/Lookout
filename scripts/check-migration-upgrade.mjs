import assert from 'node:assert/strict';import EmbeddedPostgres from 'embedded-postgres';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createPool,verifyRuntime} from '../server/db/pool.js';import {provisionTenant,secret} from './lib/local-postgres.mjs';import {PostgresStore} from '../server/db/store.js';import {tokenHash} from '../server/security.js';
const run=promisify(execFile);await mkdir('work',{recursive:true});const dir=await mkdtemp(resolve('work/upgrade-test-')),port=Number(process.env.TEST_UPGRADE_DB_PORT??55444),password=secret();
const db=new EmbeddedPostgres({databaseDir:resolve(dir,'data'),user:'postgres',password,authMethod:'scram-sha-256',port,persistent:true,postgresFlags:['-h','127.0.0.1','-k',''],onLog(){},onError(){}});
let owner,runtime,started=false;
try{
 await db.initialise();await db.start();started=true;const url=`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;owner=createPool(url);
 await owner.query('CREATE TABLE public.lookout_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');await owner.query('REVOKE ALL ON public.lookout_migrations FROM PUBLIC');
 for(const name of ['001_foundation.sql','002_runtime.sql','003_accounts.sql','004_supabase_session_lifetime.sql']){const sql=await readFile(new URL('../server/db/migrations/'+name,import.meta.url),'utf8');await owner.query(sql);await owner.query('INSERT INTO public.lookout_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);}
 const loginPassword=secret();const statement=(await owner.query("SELECT format('CREATE ROLE upgrade_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L IN ROLE lookout_runtime',$1::text) AS sql",[loginPassword])).rows[0].sql;await owner.query(statement);runtime=createPool(`postgresql://upgrade_runtime:${loginPassword}@127.0.0.1:${port}/postgres`);
 const user={id:'existing-user',name:'Existing synthetic user',role:'admin',token:secret()};await provisionTenant(owner,'existing-tenant',[user]);const baseline=(await owner.query('SELECT document,revision FROM lookout.inventory WHERE tenant_id=$1',['existing-tenant'])).rows;
 const prior=(await owner.query('SELECT name,checksum FROM public.lookout_migrations ORDER BY name')).rows;
 await run(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,MIGRATION_DATABASE_URL:url}});
 await verifyRuntime(runtime);const state=await new PostgresStore(runtime).read(tokenHash(user.token));assert.equal(state.identity.id,user.id);assert.deepEqual((await owner.query('SELECT document,revision FROM lookout.inventory WHERE tenant_id=$1',['existing-tenant'])).rows,baseline);
 assert.deepEqual((await owner.query("SELECT name,checksum FROM public.lookout_migrations WHERE name<>'005_session_bound_tenants.sql' ORDER BY name")).rows,prior);
 await run(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,MIGRATION_DATABASE_URL:url}});assert.equal((await owner.query('SELECT * FROM public.lookout_migrations')).rowCount,5);
 await assert.rejects(runtime.query('SELECT * FROM lookout.principals'),e=>e.code==='42501');
 console.log('PASS migration 005 upgrades a 001–004 database without losing existing inventory, sessions or earlier checksums; repeated migration run is idempotent and new restrictions apply.');
}finally{await runtime?.end();await owner?.end();if(started)await db.stop();await rm(dir,{recursive:true,force:true});}
