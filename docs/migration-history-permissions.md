# Migration-history permissions

This is a separate hardening change following the pool-recovery merge. It does
not change migrations 001–005, business-table privileges, RLS, identity functions,
credentials, TLS settings or project-wide default privileges.

## Problem and narrow change

Supabase-style defaults can grant API roles table privileges independently of
PUBLIC. The existing runner revoked PUBLIC but did not revoke named-role grants.
The hosted preflight found unnecessary TRUNCATE, TRIGGER and REFERENCES rights
for anon, authenticated and service_role on public.lookout_migrations; the backup
also records MAINTAIN. This does not prove anonymous browser access to arbitrary
SQL, but these capabilities do not belong on the migration ledger.

Immediately after creating/locating the ledger, the runner now revokes ALL table
privileges from each of those three roles if it exists. It retains the existing
PUBLIC revocation. This runs within the same transaction and advisory lock as
checksum verification and migrations, before committing a new or existing ledger.
Only the trusted migration owner needs this table. No application operation uses
it. No role is created, dropped or changed by the hardening block.

Conditional role lookup keeps plain PostgreSQL usable. Identifier quoting uses
format('%I', ...) over a fixed role allowlist. REVOKE ALL covers current table
privileges without depending on the server's version-specific privilege list.

The runner must be used whenever creating this ledger; global defaults remain
unchanged. Future out-of-band grants can reintroduce access, so verify effective
privileges after migrations. This block is not a general audit of arbitrary custom
roles or inherited administrative memberships.

## Verification

`npm run test:migration-permissions` uses disposable local clusters and the actual
migration runner. It checks:

- Fresh ledger creation with permissive API-role defaults: all table rights denied;
  actual reads and TRUNCATE fail under each role.
- Existing unsafe grants: removal preserves inventory and migration rows, timestamps
  and checksums.
- Repeated execution: idempotence; unrelated table grants and default privileges
  remain identical.
- Applied-checksum mismatch: the runner fails and rolls back the revocations too;
  a successful rerun then closes grants without changing history.
- Ordinary PostgreSQL without Supabase roles: migrations succeed; the restricted
  application login cannot read or modify migration history.

MAINTAIN is included in the test privilege checks on the bundled PostgreSQL 18;
the actual hardening uses portable REVOKE ALL. Local roles and records are synthetic
and all test-cluster resources are removed afterward. Tests never load private
environment files or execute hosted SQL.

## Hosted approval and recovery

No hosted changes are implied by merging this code. Before an approved migration
run on lookout-dev, explicitly approve the ledger permission cleanup as well as
005 and the separately provisioned identity login. The runner will revoke rights
on this one table before checking/applying pending migrations. If a checksum or
migration fails, the transaction rolls back; stop and investigate rather than
restoring broad permissions automatically.

The existing private pre-005 backup is a recoverable snapshot of the old ACLs.
Restoring it will restore those unsafe grants too. Keep any recovery isolated,
reapply reviewed hardening before service resumes and compare effective privileges.
Do not automatically regrant API-role rights as a rollback. Keep the owner-only
migration connection separate from both application connections.
