# Supabase Auth and PostgreSQL: focused setup

> Integration update: follow [deployment-readiness.md](deployment-readiness.md) for migration 005, separate identity/runtime credentials, bundled TLS CA, and public-release gates. The material below records the earlier foundation and may describe the superseded tenant-setting model. Hosted 005 has not been applied.


This branch continues Phase 7 commit `01bcf3d`, not the older `main`. It preserves the existing inventory engine, transactional persistence, audit trail, tenant isolation and explicit local demo. No Google, Apple or phone sign-in is required.

## What is ready, and what is waiting

Email/password signup delegates to Supabase. Before signup/login the server checks that email sign-in is enabled and automatic email confirmation is disabled. Login exchanges the password at the provider, then verifies the returned access token with `/auth/v1/user`; unverified email, mismatched identity or malformed provider sessions cannot create a Lookout session. This follows [Supabase's server-side user validation guidance](https://supabase.com/docs/reference/javascript/auth-getuser). Client JWT payloads and user metadata never establish permissions.

The browser receives only an opaque HttpOnly host cookie. Only its digest is persisted. Migration 004 bounds the database session to the provider's returned access-token lifetime, with an eight-hour maximum and elapsed login time deducted. No refresh token or provider access token is persisted. A shorter provider lifetime means the user must sign in again; automatic refresh is deliberately deferred. Cookie Max-Age remains eight hours, but an expired database session is denied even if the cookie remains. Local demo sessions remain eight hours.

Hosted Supabase, SMTP delivery and hosted database TLS have **not** been verified: this machine has no project configuration. The new integration demo uses simulated provider replies with real HTTP and real disposable PostgreSQL; it is not evidence of a live Supabase deployment.

## Minimal user setup

1. Create a dedicated Supabase project. Keep email/password enabled and **Confirm email ON**. Set Site URL to your exact HTTPS Lookout origin. Use the standard confirmation URL email template; after confirming, return to Lookout and sign in with the password. Configure SMTP for delivery beyond the provider's limited test mail service. See [password authentication](https://supabase.com/docs/guides/auth/passwords).
2. In this checkout, copy `.env.example` to the ignored `.env`. Fill `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (publishable or legacy anon key), and `APP_ORIGIN`. Never use a secret/service-role key. Set `NODE_ENV=production`, `LOOKOUT_MODE=secure`, `LOOKOUT_AUTH=supabase`. Keep all passwords and connection strings out of chat and Git.
3. From the project's Connect panel get a **direct connection** or **session pooler** connection for migrations. Put it privately in `MIGRATION_DATABASE_URL` with `sslmode=verify-full`. An IPv4-only machine may need the session pooler. Migration credentials must have schema/role provisioning privileges. Run `npm ci` and `npm run db:migrate`. Migrations 001–004 apply transactionally under an advisory lock and reject changed checksums. Existing applied migrations are untouched; no automatic destructive rollback exists. Back up an existing database first.
4. As the database administrator, create the restricted runtime login after migration:

   ```sql
   CREATE ROLE lookout_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOREPLICATION NOBYPASSRLS IN ROLE lookout_runtime;
   ```

   Set its generated password through a secure administrator tool, e.g. interactive `psql` `\password lookout_app`. Never put the password in a committed SQL file. Managed-provider permissions may require the project administrator to provision/grant the role. Database roles are cluster-wide; use a dedicated project. Do not use the administrator connection as the web runtime.
5. Set `DATABASE_URL` to that restricted login, using verified TLS. For a Supabase session pooler the username is `lookout_app.PROJECT_REF`; for direct Postgres it is `lookout_app`. Use the exact hostname and database supplied by Connect. Prefer direct/session mode for this long-running Node server; this increment does not certify transaction-pooler configuration. Configure the provider CA trust if your environment needs it. See [Supabase connection modes and custom-role usernames](https://supabase.com/docs/guides/database/connecting-to-postgres).
6. Run `npm run check:supabase`. It is read-only: Auth settings/reachability, restricted DB privileges, expected forced RLS tables and migration 004's function. It never prints credentials, creates accounts, applies migrations or changes inventory. Keep the migration-owner secret out of the running web process. After provisioning, remove `MIGRATION_DATABASE_URL` from the runtime environment and `.env`; retain it only in the protected migration job's environment.
7. Run `npm start` behind an HTTPS reverse proxy forwarding to the loopback listener. Confirm the configured origin exactly matches the browser's origin. In staging, create an account, confirm the email, sign in, add synthetic inventory, reload/restart, retry a request, and sign out. Verify an unconfirmed account is denied. For shared workflow review, the first account's admin prepares a reviewer invitation before that teammate signs up; roles cannot be self-selected. Review and execution must use different accounts.

A passing setup check cannot prove SMTP delivery, a working reverse proxy or production throughput. Pause deployment until this staging walkthrough is verified. No hosted resources are created by this change.

## Security and storage boundary

The application owns the private `lookout` schema. Do **not** expose it through Supabase's public Data API. Supabase `anon` and `authenticated` roles are not the application's database roles. Every runtime query uses the restricted `lookout_runtime` member; startup rejects owner/superuser/bypass-RLS, identity-writing and history-rewriting privileges.

Nine inventory/workflow tables have forced tenant RLS. Tenant context is transaction-local and server-selected. Composite foreign keys stop cross-tenant references. Auth tables have no direct runtime access; fixed-search-path SECURITY DEFINER functions handle account binding and sessions, with PUBLIC execution revoked. The backend credential is trusted: RLS does not defend against a compromised backend that can select another tenant context. Members intentionally share their workspace's inventory; a new uninvited account gets its own workspace.

Inventory revision checks and a tenant row lock serialize mutations. Request fingerprints and responses commit with inventory, relational projections and append-only runtime audit; identical retries return the saved response and conflicting key reuse fails. Audit failure rolls back the entire change. Migration 004 adds only a restricted session function and leaves prior migrations/data intact. Audit is not tamper-proof against a database administrator.

Supabase account disablement/global logout does not immediately invalidate an already-issued Lookout session. The new provider-lifetime cap bounds it, but immediate revocation still requires disabling the Lookout principal or deleting its sessions through trusted administration. Recovery UI, provider revocation synchronization and self-service account lifecycle remain follow-up work.

## Local verification and demo

```sh
npm test
npm run test:database
npm run test:accounts
npm run test:supabase
npm run demo:agent-context
npm run demo:agent-workflow
npm run test:agent-api
```

`test:supabase` is the focused automated demo: verified identity → isolated workspace → concurrent duplicate add once → stale stock rejection → database restart/retry → disabled/expired session → logout/audit. The Auth provider is simulated; PostgreSQL and HTTP are real. Disposable databases use separate ports 55439/55440/55441 by default.

For the existing localhost browser experience run `npm run demo:secure`. It retains real PostgreSQL and explicitly separate `local-dev` password auth, with no email verification. It cannot run in production or against a remote DB and never silently replaces failed managed Auth. Use synthetic test data only. Do not start another instance on an occupied port or copy another checkout's database secrets. Existing demo data and browser storage were not imported or changed.
