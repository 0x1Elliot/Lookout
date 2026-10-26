# Phase 7: database and backend security foundation

## Scope and architecture

The branch starts from verified GitHub `main` at `bdf434364449f05553090714eb13d17abb7d9223`. Work was isolated from the original `/Users/elliotwatson/Lookout` checkout. No push, remote PR creation or main merge is part of this change.

The browser retains the inventory/restock UI and four workflow stages. In secure mode it sends commands, not inventory snapshots. `server/db/store.js` loads authoritative inventory and passes it to the unchanged deterministic inventory/intake/reconcile/review/action functions. Reconcile/action reject caller inventory; review replaces supplied reviewer identity and timestamp with server identity and time.

PostgreSQL stores a versioned inventory JSONB document plus relational locations/items, events, cases, review history, actions, requests and audit records. The document preserves existing inventory/restock/activity contracts; relational projections enforce quantity bounds, references, and one action per case. Projection writes and the canonical document commit in the same transaction. Runtime cannot delete historical records or rewrite audit, review, action or event tables.

Each operation uses a single database connection and `BEGIN/COMMIT/ROLLBACK`. A tenant inventory row lock serializes inventory and workflow transitions. Stock commands require the current numeric revision; agent actions also recheck the existing item/activity revision. This deliberately favors correctness over throughput for this increment. The pattern follows [node-postgres transaction guidance](https://node-postgres.com/features/transactions) and [PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html).

Every mutation requires `requestId`. Durable request records are keyed by tenant, actor and request ID; a canonical input fingerprint rejects conflicting reuse. Exact retries return the original committed response. The action contract also prevents a second execution by action request ID/case. The browser reuses uncertain stock requests in its current session and rereads authoritative stock after action retries. After losing the page during an uncertain write, reload and inspect the recorded inventory before submitting another adjustment.

All request values use parameterized SQL. Dynamic table identifiers are fixed internal lists, never input. Composite foreign keys bind related data to the same tenant. Forced [row-level security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) is defense in depth on inventory/workflow tables, with a transaction-local tenant setting. The backend database credential is trusted infrastructure; RLS does not protect against a compromised backend using its credential to set another tenant context.

## Normal login and permissions

The user-facing interface is **email/password signup and login**, not manual API credentials. Production uses Supabase Auth. Signup requests account verification; password login is followed by a network call to Supabase's user endpoint. Lookout requires a provider-confirmed email and uses the verified provider subject. It never decodes an unverified JWT to establish authority and never uses `user_metadata` for permissions. See [password authentication](https://supabase.com/docs/guides/auth/passwords), [authenticated user validation](https://supabase.com/docs/reference/javascript/auth-getuser) and [metadata risks](https://supabase.github.io/splinter/0015_rls_references_user_metadata/).

Lookout then issues an independent eight-hour opaque session. Only its SHA-256 digest is stored. Production cookies use the `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`, with no Domain attribute. No auth token is stored in browser localStorage. Sessions survive application/database restarts; logout deletes the session. Principal disablement, expiry and current role are checked on every request. Disabling a Supabase user alone does not revoke an already issued Lookout session; disable its Lookout principal or delete its Lookout sessions too. Provider-wide revocation synchronization is pending.

The local demo has an explicit, separate `local-dev` adapter with salted scrypt password hashes. It cannot prove email ownership and is forbidden with `NODE_ENV=production` or a remote database. It never activates automatically when production configuration is missing.

| Role | Allowed operations |
| --- | --- |
| worker | Read shared workspace inventory/cases; add/receive stock; begin/finish shelf tasks; intake/reconcile; execute an approved action |
| reviewer | Read workspace data; approve/reject/request information |
| admin | All above; prepare worker/reviewer invitations |

Unknown roles/operations deny by default. The same principal cannot both approve and execute a case, including admins. Members within one workspace intentionally share inventory/cases; tenant boundaries provide workspace isolation, not per-item ownership.

A new uninvited account becomes admin of its **own new workspace**. An admin may prepare an email invitation for a new teammate before registration; a verified production signup using that email receives the invitation's tenant and role. No invitation email is sent by Lookout. Current scope supports one workspace per account, invitations for new accounts only, no invitation management screen, and no self-service elevation or adding new admins. Existing-member transfers and role changes require a separate administrative workflow.

## Production setup

No Supabase project, hosted database or SMTP credentials were available during implementation. The production adapter is covered by mocked provider responses; hosted signup, email delivery and TLS were **not** live-verified.

1. Provision a dedicated PostgreSQL database (managed Supabase Postgres is an option) and a Supabase Auth project. Turn on email confirmation. Configure its Site URL to the exact HTTPS Lookout origin and configure production SMTP. Enable provider-side abuse controls. Google/Apple/phone login are not implemented in this increment.
2. Install runtime dependencies with `npm ci --omit=dev`. Provision migrations from an owner/DBA connection with schema/role creation privileges:

   ```sh
   npm run db:migrate
   ```

   Set `MIGRATION_DATABASE_URL` privately before that command. Migrations are serialized, transactional, versioned and checksum-checked; rerunning is safe. Never edit an applied migration. There is no automatic destructive down migration. Database roles are cluster-wide; use a dedicated deployment and coordinate the `lookout_runtime` role with the DBA. Managed providers may require their administrator to provision the restricted login/group rather than allowing role creation through a limited connection.
3. With an owner/DBA connection, create the runtime login. The migration creates the restricted NOLOGIN group `lookout_runtime`:

   ```sql
   CREATE ROLE lookout_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE lookout_runtime;
   ```

   Use your DBA's secure password-setting method (for example interactive psql `\password lookout_app`), never a committed password. Do not grant ownership, schema CREATE, identity table writes or audit/history writes. `verifyRuntime` rejects unsafe owner/superuser/bypass/history privileges at startup. Auth tables have no direct runtime grants; a small set of `SECURITY DEFINER` functions with a fixed search path handles account binding, sessions and invitations. These are trusted backend capabilities and are revoked from PUBLIC. Do not expose the `lookout` schema through a public database API.
4. Configure private environment values:

   ```text
   NODE_ENV=production
   LOOKOUT_MODE=secure
   LOOKOUT_AUTH=supabase
   DATABASE_URL=<restricted PostgreSQL login URL with sslmode=verify-full>
   SUPABASE_URL=<Supabase project HTTPS origin>
   SUPABASE_PUBLISHABLE_KEY=<publishable or anon key, never service-role/secret>
   APP_ORIGIN=<exact HTTPS Lookout origin, no trailing slash>
   ```

   Use your provider's CA trust configuration where needed. Remote database connections reject weaker SSL modes. The runtime does not need `MIGRATION_DATABASE_URL`; keep the migration secret out of the running web process. `.env` files are ignored; the public asset allowlist excludes server source, migrations, credentials and dependencies.
5. Run `npm start`. The app listens on loopback by design; place it behind an HTTPS reverse proxy for production. Forward the exact configured origin. Missing DB/provider settings, unsafe DB privileges or production local-demo mode fail startup. No automatic fallback exists.
6. Create an owner account through the normal signup screen, verify email, then sign in. Prepare a reviewer invitation before their first signup. Test the complete reviewed-action flow in a staging environment before using real inventory.

## Secure API

Browser requests use the HttpOnly session cookie. JSON POSTs require the exact configured `Origin`; cross-site fetches are blocked. Cookies are host-only; there are no permissive CORS headers. Authentication endpoints have a 16 KB limit, other API JSON is capped at 1 MB. Requests have timeouts. Basic in-process auth rate/concurrency limits supplement provider controls; they do not replace deployment-level limits.

| Endpoint | Request |
| --- | --- |
| GET `/api/config` | Public mode/provider name only |
| POST `/api/auth/signup` | `{email,password,name}`; returns verification or local-development instructions |
| POST `/api/auth/login` | `{email,password}`; sets session cookie |
| POST `/api/auth/logout` | `{}`; revokes session and clears cookie |
| POST `/api/team/invite` | Admin session; `{email,role:"worker"\|"reviewer"}` |
| GET `/api/inventory` | Server inventory, revision, identity and workflow |
| POST `/api/inventory` | `{requestId,expectedRevision,operation,...}`; `add` takes `item:{name,count,location}`, `receive`/`begin` take `itemId,quantity`, `finish` takes `taskId,outcome` |
| GET `/api/agent/workflow` | Durable tenant workflow and inventory |
| POST `/api/agent/workflow` | Existing stage contract plus `requestId`, **without inventory snapshots**; review IDs/names/timestamps are server-controlled |
| GET `/api/agent/context` | Context built from server inventory |

The secure public server does not accept the legacy developer bearer credentials. The API-only factories used in compatibility/database tests are not deployed by `npm start`. HTTP errors distinguish authentication (401), permission/origin (403), validation (400), conflicts/stale revision (409), method (405), media type (415), body size (413), abuse limit (429) and database/provider availability (503). API responses are non-cacheable; CSP blocks inline/external scripts, framing and objects, and `nosniff` and no-referrer headers are sent.

## Verification and operational limits

Run commands from the repository root:

```sh
npm test
npm run test:database
npm run test:accounts
npm run demo:agent-context
npm run demo:agent-workflow
npm run test:agent-api
```

Database tests use generated credentials and disposable real PostgreSQL, not an in-memory SQL emulator. They verify actual constraints, privileges, tenant isolation, duplicate/concurrent adjustments, stale cases, audit rollback, stock-task behavior, and database restart durability. Account tests cover local signup/login, hash storage, role assignment/invitations, CSRF, logout, expiry and isolated workspaces. Managed provider tests use fixtures and explicitly do not establish live Supabase connectivity. No Anthropic SDK or network call was added.

Pending before public production use: live hosted DB/Auth/email verification; password recovery and MFA; deployment-level distributed rate limits and signup/CAPTCHA policy; session/provider-revocation synchronization; centralized redacted failure/denial logs and alerting; security review; backups/PITR and restore drills; TLS/proxy validation; secret rotation and vulnerability monitoring; account/invitation lifecycle administration and cleanup/retention. Audit is append-only for the runtime role, not tamper-proof against the database owner; external archival is pending.

Inventory/activity/workflow and durable responses currently grow without pagination or retention and use coarse tenant locking/full snapshots. Large tenants require pagination, archival, request-response retention policy and narrower item locks. No automatic browser-data import, live evidence-source verification, external sensors, Google/Apple/SMS login, or AI/Anthropic calls are included.
