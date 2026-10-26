# Integration, migration 005 and public presentation release

This is the current integration guide. `docs/phase-7.md` is a historical foundation
record. The initial four migrations are unchanged. Migration 005 is an additive,
reviewable permission/policy migration, tested only in disposable local databases.
No hosted approval, push, main merge or deployment is implied by local testing.

## Identity and tenant boundary

Previously RLS compared tenant_id with a caller-selected database setting. The
inventory runtime could SELECT principals and execute identity/session functions.

Migration 005 changes all nine forced-RLS policies to derive tenant authority
from `lookout.current_session_tenant()`, which resolves a live session digest
through `session_principal`. The data store sets only the transaction-local
session digest. The old tenant setting, request headers, query parameters and
body tenant/user/role fields cannot replace this authority. Expired, disabled,
revoked or nonexistent sessions yield no authorized workspace.

The inventory group loses principal SELECT and identity/session-issuance functions.
A new NOLOGIN `lookout_identity` group receives the narrow existing identity
functions and no direct table privileges. The application uses a separate login
and connection for those functions. Startup rejects combined memberships,
administrator privileges, unsafe direct access, and missing separation.

This mitigates tenant selection and identity spoofing through inventory SQL. It
does **not** make a compromised identity service or a fully compromised application
process harmless: that service is trusted to call identity functions only after
provider verification. Protect and isolate its credential, restrict code paths,
monitor failures and review SQL injection defenses. Never expose DB credentials
to browsers or the private schema through Supabase's Data API. Session digests
remain secret capabilities, and identity/admin credentials remain privileged.

The tests explicitly cover forged tenant context, cross-tenant items/cases,
forged actor/role/header/query claims, invalid/revoked sessions, denied role
switches, and denied attempts to turn row security off. The original suites
continue to test independent review/execution, concurrent writes, stale changes,
audit rollback and durable retry after database restart.

## Hosted migration plan — separate approval required

1. Back up the dedicated project and choose a coordinated application cutover.
   The old application cannot continue issuing sessions with the inventory login
   after migration 005 revokes that capability. New code deliberately fails closed
   until the new identity connection and policies are in place.
2. After explicit approval only, run `npm run db:migrate` with the owner-only
   `MIGRATION_DATABASE_URL`. The runner verifies existing checksums and adds only
   005; 001–004 are not edited or reapplied. A transaction/advisory lock covers the
   change. The migration does not rewrite application records.
3. After separate approval, provision a restricted identity LOGIN member:

   ```sql
   CREATE ROLE lookout_identity_app LOGIN INHERIT NOSUPERUSER NOCREATEDB
     NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE lookout_identity;
   ```

   Set a unique generated password privately (e.g. interactive psql
   `\password lookout_identity_app`). Never commit a password or print a URL.
   Keep `lookout_app` in `lookout_runtime` only. The groups must stay separate.
4. Privately set `AUTH_DATABASE_URL` for that new login. Session pooler usernames
   are `lookout_identity_app.PROJECT_REF` and `lookout_app.PROJECT_REF`. Use the
   Session pooler hostname/port 5432 supplied by Supabase. Preserve
   `sslmode=verify-full` on both connections.
5. Run `npm run check:supabase` and verify both identities and policies before
   release. Record unchanged 001–004 checksums, 005 checksum, restrictions and
   existing-data integrity. If anything fails, stop; no automatic destructive
   rollback or permission broadening is authorized.

Only disposable local clusters were upgraded during development. The upgrade
suite proves existing synthetic inventory and sessions survive the transition,
earlier checksums remain intact and repeated migration runs skip applied work.

## Vercel configuration prepared in source

- Node.js 24; one Web-standard function at `api/index.js` exports HTTP methods.
- `server/deployment.js` bridges streaming Web requests to the same secure Node
  request handler used locally. It preserves JSON limits, cookie/origin checks,
  authorization, transactions and database-backed state. No localhost server is
  started by the function.
- `vercel.json` rewrites API paths to that function and uses `public/` for assets.
- `npm run build` copies exactly seven allowlisted browser files. The repository
  root, server source, local data, credentials, migrations, tests and binaries are
  not the public directory. The public root CA is bundled with the function.
- Initialization is reused per warm function instance, with retry after failed
  initialization. Each of the two pools has at most five connections per instance;
  budget aggregate connections against the project's pooler limits.
- The PostgreSQL driver supplies the bundled CA for Supabase endpoints if the URI
  has verify-full and no explicit rootcert. Do not deploy a laptop absolute path.
  Hostname and chain verification are never disabled.
- Vercel's overwritten forwarded header is used as a limiter key only when the
  VERCEL platform environment flag is set. It never selects account/tenant identity.
  Existing auth attempt/concurrency limits are still per process, not distributed.
  Provider controls and deployment-level abuse protection must be configured before
  opening public signup; verify effective behavior on the actual platform.

These local checks validate the adapter and production asset build, not Vercel's
remote build, routing or runtime environment. No Vercel project is linked and no
CLI remote build/deployment has been performed. Test those after explicit approval.

## Private runtime environment

Configure these directly in protected deployment settings:

| Variable | Purpose |
| --- | --- |
| NODE_ENV | production |
| LOOKOUT_MODE | secure |
| LOOKOUT_AUTH | supabase |
| DATABASE_URL | Restricted inventory login; verify-full; no laptop CA path |
| AUTH_DATABASE_URL | Separate restricted identity login; verify-full |
| SUPABASE_URL | Project HTTPS origin without REST path/trailing slash |
| SUPABASE_PUBLISHABLE_KEY | Publishable/legacy anon key, never a service secret |
| APP_ORIGIN | Exact final HTTPS application origin, no trailing slash |

Never deploy `MIGRATION_DATABASE_URL`. Do not prefix private variables with a
browser-public convention. No Anthropic variable or paid LLM calls are required.
Do not populate APP_ORIGIN with an unreserved example domain. Current `.env.example`
intentionally leaves the eventual address unspecified.

## Public URL and Supabase account setup

After main and the release are approved, choose an available stable Vercel HTTPS
address. `lookout.vercel.app` is an example, not a reserved or verified domain.
Use that exact origin for APP_ORIGIN and Supabase Auth's Site URL; allow only
intended confirmation redirect URLs. The standard Supabase confirmation URL
confirms email at the provider, then returns to the application. Lookout discards
provider token fragments and requires normal password sign-in. Confirm the email
template and actual delivery instead of assuming mail settings are sufficient.

Do not expose the app publicly until authorization/abuse controls pass. A linked
Git repository can deploy automatically on push; configure release protection
before connecting or pushing. Opening a PR is not deployment approval.

After deployment approval, make the chosen shareable URL accessible without
Vercel authentication/password/IP restrictions, while retaining Lookout's login
and protected API. A private/incognito browser must reach the signup/login screen
without platform cookies or protection-bypass tokens.

## Live release checks still required

1. Verify remote build and API rewrites; test direct and rewritten API routes.
2. Verify no secrets/source/local files are served and TLS connections validate
   from the deployed function, using the restricted inventory/identity roles.
3. Real authorized mailbox signup, email confirmation, password login, reload,
   session expiry/logout and persistent inventory across cold starts.
4. Two uninvited accounts must see different workspaces. Attempt cross-tenant
   item/case IDs and forged tenant/actor/role claims with real sessions.
5. Invite a reviewer before their first signup; use a different worker/admin to
   execute the approval. Check rejection and request-more-information paths.
6. Add/receive stock, replenish/return, intake/reconcile/review/apply and repeat an
   uncertain request against the real backend. No fake state or localStorage fallback.
7. Desktop, mobile and fresh private browser contexts; confirmation redirects to
   the exact public origin; useful errors and usable layout without console failures.
8. Use isolated presentation accounts/workspaces and synthetic merchandise only.
   Keep credentials out of README, logs, screenshots and the public checklist.

Do not claim public-release success or 10K-user capacity from local tests.
