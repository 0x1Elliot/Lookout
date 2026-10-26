import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { secureConfig } from '../security.js';
export function createPool(connectionString) {
  secureConfig({ DATABASE_URL: connectionString });
  const url = new URL(connectionString);
  // This public CA is bundled with the function; never depend on a laptop path.
  if (url.searchParams.get('sslmode') === 'verify-full' && !url.searchParams.has('sslrootcert')
    && (url.hostname.endsWith('.pooler.supabase.com') || url.hostname.endsWith('.supabase.co'))) {
    url.searchParams.set('sslrootcert', fileURLToPath(new URL('../../certs/supabase-root-ca.crt', import.meta.url)));
  }
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, application_name: 'lookout' });
  // pg already discards a failed idle client. Observe the event without logging
  // its error/client object (which can contain credentials), or retrying writes.
  pool.on('error', () => console.warn('PostgreSQL idle connection lost; no operation was automatically retried.'));
  const connections = new Set();
  pool.on('connect', client => {
    // Checked-out clients can fail between queries, when pg has no query/idle
    // error listener installed. Subsequent queries still reject normally.
    client.on('error', () => {});
    let closed;
    const disconnected = new Promise(resolve => { closed = resolve; });
    connections.add(disconnected);
    client.once('end', () => { connections.delete(disconnected); closed(); });
  });
  const end = pool.end.bind(pool);
  let closing;
  // pg's end promise can resolve before removed clients finish disconnecting.
  // Also wait for those sockets, including clients discarded after SQL errors.
  pool.end = () => closing ??= (async () => {
    await end();
    await Promise.all([...connections]);
  })();
  return pool;
}
export async function verifyRuntime(pool) {
  const { rows: [role] } = await pool.query(`SELECT r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
    pg_has_role(current_user, 'lookout_runtime', 'member') AS member,
    has_table_privilege(current_user, 'lookout.principals', 'SELECT') AS reads_principals,
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='lookout' AND p.proname IN ('register_account','local_account','start_session','end_session','invite_member','start_supabase_session')
      AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS issues_sessions,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='lookout' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_objects,
    pg_has_role(current_user, 'lookout_identity', 'member') AS identity_member,
    to_regprocedure('lookout.current_session_tenant()') IS NOT NULL AS session_bound,
    has_schema_privilege(current_user, 'lookout', 'CREATE') AS owns_schema,
    has_table_privilege(current_user, 'lookout.audit', 'UPDATE') AS rewrites_audit,
    has_table_privilege(current_user, 'lookout.principals', 'INSERT,UPDATE,DELETE,TRUNCATE') AS changes_identity,
    EXISTS (SELECT 1 FROM (VALUES ('locations'),('events'),('reviews'),('actions'),('requests'),('audit')) AS history(name)
      WHERE has_table_privilege(current_user, 'lookout.' || history.name, 'UPDATE,DELETE,TRUNCATE')) AS rewrites_history
    FROM pg_roles r WHERE r.rolname=current_user`);
  if (!role?.member || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.rolreplication
    || role.owns_objects || role.reads_principals || role.issues_sessions || role.identity_member || !role.session_bound
    || role.owns_schema || role.rewrites_audit || role.changes_identity || role.rewrites_history) throw new Error('Unsafe runtime database privileges. Use a restricted lookout_runtime login.');
}

export async function verifyIdentity(pool) {
  const {rows:[r]} = await pool.query(`SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,
    pg_has_role(current_user,'lookout_identity','member') AS member,
    pg_has_role(current_user,'lookout_runtime','member') AS runtime_member,
    has_schema_privilege(current_user,'lookout','CREATE') AS schema_create,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='lookout' AND c.relkind='r'
      AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) AS direct_tables,
    has_function_privilege(current_user,'lookout.start_supabase_session(text,text,integer)','EXECUTE') AS session_capability
    FROM pg_roles WHERE rolname=current_user`);
  if (!r?.member || r.rolsuper || r.rolbypassrls || r.rolcreaterole || r.rolcreatedb || r.rolreplication || r.runtime_member
    || r.schema_create || r.direct_tables || !r.session_capability) {
    throw new Error('Unsafe identity database privileges. Use a separate restricted lookout_identity login.');
  }
}
