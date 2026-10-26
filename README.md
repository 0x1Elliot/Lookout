# Lookout

Lookout records inventory, shelf-restock tasks, and a deterministic four-stage discrepancy workflow: detection → reconciliation → human review → inventory action. Phase 7 adds a PostgreSQL backend, normal email signup/login, server-owned inventory, tenant isolation, and durable audit/idempotency records. No Anthropic calls are made.

## Start the working local demo

Requires Node.js 22.21 or newer, npm, and a supported macOS/Linux/Windows host for the development PostgreSQL binary. Run as a normal user, not root.

```sh
npm ci
npm run demo:secure
```

Open http://127.0.0.1:4173. Choose **Create an account**, enter a test name/email and a new test password of at least 12 characters, then sign in. No developer access credential is needed. This command starts real PostgreSQL on loopback port 55432, applies migrations, and starts Lookout. Local database files and generated database passwords stay in ignored `work/local-db/`; rerunning the command preserves data. Stop with Ctrl-C.

This is explicitly **local development authentication**: emails are not verified, and no email is sent. Do not use real passwords or sensitive data. Production refuses this authentication mode. Production uses Supabase Auth with verified email, described in [Phase 7 setup](docs/phase-7.md).

## Try the four stages with two people/accounts

1. Create an owner account. It becomes admin of its own new workspace, never another workspace.
2. In **Invite a teammate**, enter a new test email and choose **Reviewer**, then **Prepare invitation**. No email is sent; share the site address yourself. Invite before that person signs up.
3. As owner, click **Add sample item (8 units)** and **Run synthetic test event** with count 5. Stock stays at 8.
4. Sign out. Create the invited reviewer account with that exact email, then sign in. Click **Load saved cases and refresh inventory**, select the awaiting-review case, enter a reason, and approve. Stock stays at 8.
5. Sign out and sign back into the owner account. Load saved cases, select the approved case, and apply. Inventory becomes 5 and Activity shows the reviewed 8 → 5 adjustment.
6. Reload or restart the server/database. Inventory and workflow survive. Load saved cases to resume. A stale case requires a **new event**, as in Phase 6.

Browser tabs at the same origin share the login cookie. Use sign-out/sign-in to switch identities, or separate browser profiles. An admin cannot execute their own approval. Workers can change stock/run detection and actions; reviewers can read and review; admins can also prepare worker/reviewer invitations. Authorization is enforced on the server, regardless of visible controls.

## Inventory and durability

Add inventory with a name, unit count and storage location. Record received stock to add units. Beginning a shelf restock deducts units immediately; **Returned** restores them, and **Shelf restocked** keeps the deduction. The existing deterministic rules and four-agent contracts remain in use.

Secure mode ignores caller-supplied inventory snapshots and never imports or deletes old browser storage. Existing browser-only records remain available in explicit legacy demo mode; importing them into production is a separate reviewed migration.

## Verify

```sh
npm test
npm run test:database
npm run test:accounts
npm run demo:agent-context
npm run demo:agent-workflow
npm run test:agent-api
```

`npm test` runs the original 41 tests plus six security/authentication tests (47 total). `test:database` creates a disposable real PostgreSQL cluster and runs 19 integration/security check groups, including actual HTTP requests, concurrency, rollback, RLS and database restart. `test:accounts` runs ten additional real PostgreSQL signup/login/session checks. No hosted database or Supabase project is assumed. Development PostgreSQL binaries are a dev dependency, not a production database server.

The original context/workflow demos and API scenarios deliberately use synthetic, unauthenticated **demo factories**. For the old dashboard and the 21 live HTTP scenarios:

```sh
PORT=4174 npm run start:demo
# In another terminal:
npm run test:agent-api -- --url http://127.0.0.1:4174
npm run test:legacy-curl
```

The legacy walkthrough and its 20 curl requests are in [agent-operations.md](docs/agent-operations.md). Those requests are for explicit demo mode only, not proof of production authentication.

## Production setup and current limits

`npm start` defaults to secure mode and fails if the database or managed authentication is not configured. There is no automatic fallback. See [Phase 7 architecture, setup, API and remaining controls](docs/phase-7.md).

This is a production-oriented foundation, not a completed production deployment. Hosted PostgreSQL/Supabase verification, SMTP/email delivery, password recovery UI, social/phone login, MFA, distributed abuse controls, backup/restore drills and deployment operations remain pending. Supabase email identity is validated server-side; user-editable metadata never authorizes a role or tenant.
