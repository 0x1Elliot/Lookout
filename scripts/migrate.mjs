import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPool } from '../server/db/pool.js';
import { loadLocalEnv } from '../server/config.js';
loadLocalEnv();
if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required (owner connection, never runtime).');
const pool = createPool(process.env.MIGRATION_DATABASE_URL);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(7001007)");
  await client.query('CREATE TABLE IF NOT EXISTS public.lookout_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  await client.query('REVOKE ALL ON public.lookout_migrations FROM PUBLIC');
  // Supabase defaults can grant API roles rights independently of PUBLIC.
  // Restrict only this ledger; leave project-wide defaults and other tables alone.
  await client.query(`DO $$ DECLARE api_role text; BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.lookout_migrations FROM %I',api_role);
      END IF;
    END LOOP;
  END $$`);
  for (const name of ['001_foundation.sql', '002_runtime.sql', '003_accounts.sql', '004_supabase_session_lifetime.sql', '005_session_bound_tenants.sql']) {
    const sql = await readFile(new URL(`../server/db/migrations/${name}`, import.meta.url), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    const { rows: [prior] } = await client.query('SELECT checksum FROM public.lookout_migrations WHERE name=$1', [name]);
    if (prior && prior.checksum !== hash) throw new Error(`Applied migration changed: ${name}`);
    if (!prior) {
      await client.query(sql);
      await client.query('INSERT INTO public.lookout_migrations(name,checksum) VALUES($1,$2)', [name, hash]);
    }
  }
  await client.query('COMMIT');
  console.log('Migrations applied.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
