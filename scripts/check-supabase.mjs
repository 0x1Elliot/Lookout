import { loadLocalEnv } from '../server/config.js';
import { authConfig, AccountAuth } from '../server/auth.js';
import { secureConfig } from '../server/security.js';
import { createPool, verifyRuntime, verifyIdentity } from '../server/db/pool.js';

// Read-only: no signup, migrations, schema writes or inventory changes.
loadLocalEnv();
const required = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','APP_ORIGIN','DATABASE_URL','AUTH_DATABASE_URL'];
const missing = required.filter(key => !process.env[key]);
let pool, identityPool;
try {
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}. See docs/supabase-setup.md.`);
  const config = authConfig({ ...process.env, LOOKOUT_AUTH: 'supabase' });
  const database = secureConfig({ ...process.env, LOOKOUT_MODE: 'secure' });
  pool = createPool(database.databaseUrl);
  await new AccountAuth(pool, config).verifyProviderSettings();
  console.log('PASS Auth reachable; email sign-in and confirmation enabled.');
  await verifyRuntime(pool);
  secureConfig({ DATABASE_URL: process.env.AUTH_DATABASE_URL });
  identityPool = createPool(process.env.AUTH_DATABASE_URL);
  await verifyIdentity(identityPool);
  const { rows: [schema] } = await pool.query(`SELECT
    to_regprocedure('lookout.current_session_tenant()') IS NOT NULL AS session_migration,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='lookout' AND c.relname IN ('inventory','locations','items','events','cases','reviews','actions','requests','audit')
      AND c.relrowsecurity AND c.relforcerowsecurity) = 9 AS isolated`);
  if (!schema?.session_migration || !schema.isolated) throw new Error('Apply all migrations before starting Lookout.');
  console.log('PASS restricted PostgreSQL runtime connection; expected RLS tables and session-bound tenant migration and separate identity permissions present.');
  console.log('Read-only preflight passed. Email delivery, browser login, TLS proxy, rollback and capacity still need staging verification.');
} catch (error) {
  // Driver/provider errors can contain credentials or response bodies. Never print them.
  const safe = missing.length ? `Missing configuration: ${missing.join(', ')}. See docs/supabase-setup.md.`
    : 'Setup check failed. Verify Auth settings, database TLS/role and migrations using docs/supabase-setup.md. No secrets are printed.';
  console.error(safe);
  process.exitCode = 1;
} finally { await pool?.end(); await identityPool?.end(); }
