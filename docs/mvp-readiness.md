# Focused MVP readiness: first 10K users

10K registered users is different from 10K simultaneous writers. No load test has been run and this branch makes no capacity claim. Correctness checks demonstrate specific conflict handling, not a throughput ceiling.

| Priority | Next step | Why / acceptance evidence |
| --- | --- | --- |
| Now | Configure hosted Supabase Auth/Postgres, confirmation mail and HTTPS; run staging signup and reviewed inventory flow | Live identity, SMTP, managed role privileges, migrations and TLS remain unverified. Require unconfirmed denial, verified login, restart persistence, cross-tenant denial and logout. |
| Before public MVP | Distributed signup/login/request limits and abuse policy; password recovery; account disable/revocation workflow | In-process limits reset per process. Bound sessions help but provider bans/global logout do not immediately revoke local sessions. Test revocation and recovery without tenant/role escalation. |
| Before public MVP | Managed backups/PITR, restore drill, redacted operational logs/alerts and secret rotation | Durable storage alone is not recoverability. Demonstrate restore and detect DB/auth failures, slow requests and denied actions without logging secrets. |
| Before claiming 10K readiness | Define active-user/write mix; load test separate tenants and one hot tenant against hosted staging | Record p95/p99, errors, pool saturation and lock waits. Assert conserved stock, monotonic revisions, one action per case and idempotent retry after failure. Set an explicit target before measuring. |
| When measured load requires it | Paginate workflow/history; archive audit/request responses under a defined retry window; reduce full-snapshot rewrites and tenant-wide locks | Reads also take the tenant lock, and state/history grows unbounded. Hot-workspace throughput and response size are likely limits. Narrower locks must preserve action/revision correctness. |
| Before adding web replicas | Budget total connections and validate pooler/proxy mode; shared limits and monitoring | Current pool is 10 connections per process. Total demand scales with replica count; 10K users must not become 10K database connections. |

Already present: transactions and rollback, revision conflicts, durable idempotency, relational constraints, tenant isolation, server-controlled identity/role, independent reviewer/executor, runtime audit append restrictions and real-PostgreSQL concurrency tests. Google/Apple/phone login can follow later and is not a prerequisite for this focused email/password MVP.
