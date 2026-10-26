import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createPool} from '../server/db/pool.js';
import {provisionTenant,secret,localPostgres} from './lib/local-postgres.mjs';

// Standalone synthetic clusters only. Never loads the user's .env or uses a
// hosted connection. Invoke the actual runner, including its transaction.
const run=promisify(execFile),roles=['anon','authenticated','service_role'];
await mkdir('work',{recursive:true});
const dir=await mkdtemp(resolve('work/migration-permissions-'));
const password=secret(),port=Number(process.env.TEST_LEDGER_DB_PORT??55452);
const url=`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
const db=new EmbeddedPostgres({databaseDir:resolve(dir,'data'),user:'postgres',password,authMethod:'scram-sha-256',port,
  persistent:true,postgresFlags:['-h','127.0.0.1','-k',''],onLog(){},onError(){}});
let owner,started=false,plain,plainDir,checks=0;
const pass=message=>{checks++;console.log('PASS '+message);};
const migrate=()=>run(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,MIGRATION_DATABASE_URL:url}});
const history=async()=> (await owner.query('SELECT name,checksum,applied_at FROM public.lookout_migrations ORDER BY name')).rows;
async function denied() {
  const {rows}=await owner.query(`SELECT role,has_table_privilege(role,'public.lookout_migrations',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS permitted FROM unnest($1::text[]) role`,[roles]);
  assert.ok(rows.every(r=>!r.permitted));
  assert.equal((await owner.query("SELECT has_table_privilege(current_user,'public.lookout_migrations','SELECT,INSERT,UPDATE,DELETE') AS p")).rows[0].p,true);
  for(const role of roles) {
    const c=await owner.connect();
    try {
      await c.query(`SET ROLE ${role}`);
      await assert.rejects(c.query('SELECT * FROM public.lookout_migrations'),e=>e.code==='42501');
      await assert.rejects(c.query('TRUNCATE public.lookout_migrations'),e=>e.code==='42501');
    } finally {await c.query('RESET ROLE');c.release();}
  }
}
try {
  await db.initialise();await db.start();started=true;owner=createPool(url);
  for(const role of roles)await owner.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await owner.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role');
  const defaults=(await owner.query('SELECT defaclrole,defaclnamespace,defaclobjtype,defaclacl::text FROM pg_default_acl ORDER BY oid')).rows;
  await owner.query('CREATE TABLE public.unrelated_fixture(id integer)');
  await migrate();await denied();const initial=await history();assert.equal(initial.length,5);
  pass('fresh ledger under permissive Supabase-style defaults denies API-role reads and TRUNCATE');

  await provisionTenant(owner,'ledger-synthetic',[{id:'ledger-owner',name:'Synthetic owner',role:'admin',token:secret()}]);
  const data=(await owner.query('SELECT tenant_id,document,revision FROM lookout.inventory ORDER BY tenant_id')).rows;
  await owner.query('GRANT ALL ON public.lookout_migrations TO PUBLIC,anon,authenticated,service_role');
  await migrate();await denied();assert.deepEqual(await history(),initial);
  assert.deepEqual((await owner.query('SELECT tenant_id,document,revision FROM lookout.inventory ORDER BY tenant_id')).rows,data);
  pass('existing overprivileged ledger hardened without changing inventory, migration rows, timestamps or checksums');

  await migrate();await denied();assert.deepEqual(await history(),initial);
  assert.deepEqual((await owner.query('SELECT defaclrole,defaclnamespace,defaclobjtype,defaclacl::text FROM pg_default_acl ORDER BY oid')).rows,defaults);
  for(const role of roles)assert.equal((await owner.query("SELECT has_table_privilege($1,'public.unrelated_fixture','TRUNCATE') AS p",[role])).rows[0].p,true);
  pass('repeated runner stays idempotent; unrelated table grants and global default privileges untouched');

  await owner.query('GRANT TRUNCATE ON public.lookout_migrations TO anon');
  await owner.query("UPDATE public.lookout_migrations SET checksum='synthetic-invalid-checksum' WHERE name='005_session_bound_tenants.sql'");
  await assert.rejects(migrate(),e=>e.code===1 && e.stderr.includes('Applied migration changed'));
  assert.equal((await owner.query("SELECT has_table_privilege('anon','public.lookout_migrations','TRUNCATE') AS p")).rows[0].p,true);
  await owner.query('UPDATE public.lookout_migrations SET checksum=$1 WHERE name=$2',[initial[4].checksum,initial[4].name]);
  await migrate();await denied();assert.deepEqual(await history(),initial);
  pass('checksum failure rolls back permission changes; successful rerun preserves history and closes grants');

  plainDir=await mkdtemp(resolve('work/migration-permissions-plain-'));
  plain=await localPostgres(plainDir,port+1);
  assert.equal((await plain.owner.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")).rows[0].n,0);
  assert.equal((await plain.owner.query('SELECT count(*)::int AS n FROM public.lookout_migrations')).rows[0].n,5);
  assert.equal((await plain.owner.query("SELECT has_table_privilege('lookout_app','public.lookout_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS p")).rows[0].p,false);
  pass('ordinary PostgreSQL without Supabase roles migrates successfully; runtime cannot access ledger');
  console.log(`${checks} migration-ledger permission groups passed. No hosted SQL executed.`);
} finally {
  await plain?.owner.end();await plain?.db.stop();if(plainDir)await rm(plainDir,{recursive:true,force:true});
  await owner?.end();if(started)await db.stop();await rm(dir,{recursive:true,force:true});
}
