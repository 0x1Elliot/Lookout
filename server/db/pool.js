import pg from 'pg';
export function createPool(connectionString) {
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, application_name: 'lookout' });
}
export async function verifyRuntime(pool) {
  const { rows: [role] } = await pool.query(`SELECT r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
    pg_has_role(current_user, 'lookout_runtime', 'member') AS member,
    has_schema_privilege(current_user, 'lookout', 'CREATE') AS owns_schema,
    has_table_privilege(current_user, 'lookout.audit', 'UPDATE') AS rewrites_audit,
    has_table_privilege(current_user, 'lookout.principals', 'INSERT,UPDATE,DELETE,TRUNCATE') AS changes_identity,
    EXISTS (SELECT 1 FROM (VALUES ('locations'),('events'),('reviews'),('actions'),('requests'),('audit')) AS history(name)
      WHERE has_table_privilege(current_user, 'lookout.' || history.name, 'UPDATE,DELETE,TRUNCATE')) AS rewrites_history
    FROM pg_roles r WHERE r.rolname=current_user`);
  if (!role?.member || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb
    || role.owns_schema || role.rewrites_audit || role.changes_identity || role.rewrites_history) throw new Error('Unsafe runtime database privileges. Use a restricted lookout_runtime login.');
}
