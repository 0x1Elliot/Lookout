# PostgreSQL connection recovery

Both inventory and identity pools, migration utilities and local integration
helpers use `server/db/pool.js`. Remote TLS validation is unchanged: verify-full,
trusted CA and hostname checking remain required. No administrator fallback exists.

## Failure handling

The original pool had no `error` listener. A terminated idle PostgreSQL connection
caused an unhandled EventEmitter error and process exit. Checked-out clients can
also emit errors between queries. Additionally, pg's pool-end promise can resolve
while removed clients' sockets are still closing, racing test-cluster shutdown.

The shared factory now observes idle errors with a static, credential-free warning.
pg removes failed idle clients; new requests create connections on demand. A client
listener protects between-query gaps, while the transaction records disconnects
and refuses to commit after them. Query errors still reject. Failed rollback does
not replace the original error, and broken transaction clients are discarded.

Connection failures return controlled 503 responses. Closing applications reject
new requests, pool shutdown drains borrowers and waits for physical disconnection,
and repeated close calls share the same promise. Checked-out clients must still be
released by their callers. Normal queries retain their statement timeout.

There is no reconnect loop or automatic operation retry. Existing connection limits
and timeouts remain five clients per pool, five-second connection acquisition and
ten-second statements. A request racing a disconnect may receive 503 even when the
next request succeeds. Retrying a write must reuse its original requestId: loss of
a response after COMMIT can make the outcome uncertain. Never assume every failed
HTTP response means a write did not commit. The durable request ledger resolves
replays; do not silently generate a new key.

## Verification

Run `npm run test:pool-recovery`. It creates a disposable local PostgreSQL cluster,
synthetic tenants and restricted logins. It never loads `.env` or contacts Supabase.
It exercises both idle pools, concurrent runtime failures before audit completion,
identity failure during logout, between-query disconnects, three complete outages,
durable explicit retries, tenant/RLS/role boundaries after reconnect and shutdown.
The test makes at most three explicit recovery requests when termination races a
request; the application itself never retries operations. Failed expected requests
must return 503 with a generic database error. A unit test checks diagnostic redaction.

Five final rounds passed all unit, database, account, provider-fixture, tenant,
deployment-adapter, migration-upgrade, recovery, compatibility API, demo and build
checks. Each round includes 55 unit tests and eight recovery groups. Together the
recovery runs cover 50 idle disconnect/reconnect cycles and 15 database outages.
The unchanged integration baseline was separately reproduced exiting 1 on an idle
disconnect. Earlier exploratory failures identified expected 503 races and either
57P01 or a transport-termination error; the final tests accept those controlled
forms and still require bounded recovery and preserved data.

## Hosted recovery gate

The current lookout-dev dashboard has no scheduled backups or PITR on its Free
plan. An explicitly authorized, private Lookout-only logical export was restored
in isolation and compared with the source: 14 tables, nine RLS policies, seven
functions, effective table ACLs, role membership, four migration checksums and all
application record counts (currently zero). A local-only 005 upgrade then passed.
No hosted migration, role or permission was changed.

This is scoped migration recovery, not project-wide disaster recovery. Supabase
Auth, Storage objects, unrelated schemas and credentials are excluded. Offline
Lookout roles have no passwords and remain NOLOGIN until privately reconfigured.
Local NOLOGIN placeholders for `anon`, `authenticated` and `service_role` were
needed to restore existing ACL references; they do not recreate managed Supabase
services. The scoped restore needed no extra extensions. Dumps omit ownership;
restore with the trusted owner to preserve SECURITY DEFINER behavior. Retain the
private backup, verify hashes before use and refresh it if hosted state changes.

An additional existing issue was discovered: public.lookout_migrations grants
TRUNCATE, TRIGGER and REFERENCES (and the dump records MAINTAIN) to named Supabase
roles. Revoking PUBLIC does not revoke named-role grants. This does not establish
that a browser can issue arbitrary SQL, but migration history should be owner-only.
Review and approve narrowly revoking those grants separately before hosted cutover.
This pool fix deliberately does not change migrations or hosted permissions.

Before any hosted restore, stop application writers, confirm the exact target,
verify the backup, restore-test the plan and obtain approval. Do not restore over
live records, reset migration history or reintroduce the old tenant-setting
policies automatically. Prefer a reviewed forward fix after a committed cutover.
