import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPool } from '../../server/db/pool.js';
import { tokenHash } from '../../server/security.js';
import { createEmptyInventoryState } from '../../inventory.js';
const run = promisify(execFile);
export async function provisionTenant(owner, tenant, identities) {
  await owner.query('INSERT INTO lookout.tenants(id) VALUES($1)', [tenant]);
  await owner.query('INSERT INTO lookout.inventory(tenant_id,document) VALUES($1,$2)', [tenant, createEmptyInventoryState()]);
  for (const identity of identities) {
    await owner.query(`INSERT INTO lookout.principals(tenant_id,id,name,role,token_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`, [tenant, identity.id, identity.name, identity.role, tokenHash(identity.token)]);
    const accountId = `${tenant}:${identity.id}`;
    await owner.query(`INSERT INTO lookout.auth_accounts(id,provider,subject,email,tenant_id,principal_id)
      VALUES($1,'local-dev',$1,$2,$3,$4)`, [accountId, `${accountId}@example.test`, tenant, identity.id]);
    await owner.query("INSERT INTO lookout.sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [tokenHash(identity.token),accountId]);
  }
}
export const secret = () => randomBytes(32).toString('base64url');
export async function localPostgres(directory, port) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secretsFile = resolve(directory, 'secrets.json');
  let secrets;
  try { secrets = JSON.parse(await readFile(secretsFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    secrets = { ownerPassword: secret(), runtimePassword: secret() };
    await writeFile(secretsFile, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
  }
  if (!secrets.identityPassword) {
    secrets.identityPassword = secret();
    await writeFile(secretsFile, JSON.stringify(secrets), {mode:0o600});
  }
  const db = new EmbeddedPostgres({ databaseDir: resolve(directory, 'data'), user: 'postgres', password: secrets.ownerPassword,
    authMethod: 'scram-sha-256', port, persistent: true, postgresFlags: ['-h', '127.0.0.1', '-k', ''], onLog() {}, onError() {} });
  try { await access(resolve(directory, 'data/PG_VERSION')); } catch { await db.initialise(); }
  await db.start();
  const ownerUrl = `postgresql://postgres:${secrets.ownerPassword}@127.0.0.1:${port}/postgres`;
  const runtimeUrl = `postgresql://lookout_app:${secrets.runtimePassword}@127.0.0.1:${port}/postgres`;
  const identityUrl = `postgresql://lookout_identity_app:${secrets.identityPassword}@127.0.0.1:${port}/postgres`;
  try {
    await run(process.execPath, ['scripts/migrate.mjs'], { env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl } });
    const owner = createPool(ownerUrl);
    const { rows } = await owner.query("SELECT 1 FROM pg_roles WHERE rolname='lookout_app'");
    if (!rows.length) {
      const { rows: [sql] } = await owner.query("SELECT format('CREATE ROLE lookout_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L IN ROLE lookout_runtime', $1::text) AS command", [secrets.runtimePassword]);
      await owner.query(sql.command);
    }
    if (!(await owner.query("SELECT 1 FROM pg_roles WHERE rolname='lookout_identity_app'")).rows.length) {
      const {rows:[sql]} = await owner.query("SELECT format('CREATE ROLE lookout_identity_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L IN ROLE lookout_identity',$1::text) AS command",[secrets.identityPassword]);
      await owner.query(sql.command);
    }
    return { db, owner, runtimeUrl, identityUrl, secrets };
  } catch (error) { await db.stop(); throw error; }
}
