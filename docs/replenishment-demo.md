# Synthetic replenishment reviewer lab

Run `npm ci`, then `npm run demo:replenishment`. Open http://127.0.0.1:4180.
This loopback-only, opt-in lab uses fictional data and cannot place purchases. It is
separate from the authenticated inventory workspace and excluded from production
assets. Never expose the lab through a public tunnel or use real operational data.
Restart the process for a clean fixture. No existing inventory is loaded or replaced.

## Reviewer walkthrough

1. Inspect two fictional supermarket tenants, each with four SKUs, storage bays,
   unit costs, thresholds, targets and a fictional supplier. Prices are illustrative
   US dollars, not quotes; taxes, freight and spoilage are outside this demonstration.
2. Run low-stock detection. Oat drink (8 < 12) proposes 40 units / $99.60;
   tomatoes (18 < 24) propose 54 / $69.66. Rice is healthy; milk's 24 confirmed
   inbound units cover its low physical count (4 + 24 >= 10).
3. Try **Agent: simulate order** on oats: it must be held for human review.
   **Human: approve once**, then simulate. On-hand stays 8; projected becomes 48.
   Retry simulation: exactly one audit order remains. This permission covers one
   exact proposal, not future orders of the same product.
4. For tomatoes, **Human: grant tomato policy**, then simulate without per-order
   approval. The server checks an explicitly granted, tenant/SKU/supplier-scoped,
   versioned policy, expiring in one hour, capped at 60 units and $100 per order.
   Revoke before execution to see fallback to human review. A rejected proposal
   cannot execute even with a standing policy. Grants never retroactively undo an
   already simulated order.
5. **Operator: synthetic receipt** is the only replenishment action changing
   physical on-hand. Repeating it cannot double receive. This is invented receipt
   evidence, not proof that any physical shipment arrived.
6. Switch tenants: decisions, policies, inventory and audit are separate. The tenant
   selector is a fixture switch for reviewers, not an authentication mechanism.
7. Review audit identities, proposal references, authorization and policy versions.
   Pending proposals expire after 15 minutes; detect again to get fresh proposals
   requiring fresh authorization. Rejection suppresses automatic reproposal while
   the physical count is unchanged. There is no background scheduler or learning
   that expands agent authority.

`npm test` covers the simulator and existing app. `npm run test:replenishment`
checks the actual loopback HTTP server. `npm run build` continues to publish only
existing allowlisted workspace assets. The demo has no purchasing client, credentials,
webhooks, email sender or external network calls.

## Inspection before implementation (2026-10-29)

Base main was `0634958`, the merged event-idempotency fix (#5). Draft #6
(`fix/startup-initialization`, `2e145d5`) and #7
(`integration/huma-dashboard-startup`, `9fe0337`) were open and left untouched.
The repository had 14 branches including historical inventory, context, dashboard,
auth/database, security and integration work. This feature starts on a new branch
from main; it does not incorporate unmerged drafts or authorize deployment.

- `inventory.js`: schema v2, locations, quantityOnHand, restockTasks and activity.
  `beginRestock` deducts backroom stock immediately; returned tasks restore it,
  shelf-restocked tasks keep the deduction. `restockInventoryItem` records receipt.
  These semantics and functions are unchanged.
- `server/agents`: Detection/event intake validates synthetic count evidence;
  Reconciliation proposes a verified count with revision/evidence; Review Coordination
  records explicit decisions; Inventory Action applies an approved correction.
  They are deterministic stages, not autonomous LLMs. Their responsibilities remain.
- `server/db/store.js`, `server/security.js`, auth and migrations: secure mode derives
  authority from sessions, uses forced tenant RLS and separate identity/runtime
  logins, role checks, tenant transaction locks, request fingerprints, audit and
  independent reviewer/action identities. Demo-mode self-reported reviewers are
  not equivalent to these protections.
- `agent-operations.js` and existing demo scripts: synthetic single-item/count
  demonstrations existed. No supplier, purchase order, procurement or external
  replenishment integration was found in the inspected source.

## Boundaries and future production design

This increment implements a demonstrator, not production procurement. Its opaque
capabilities are issued only by the trusted fixture harness. Agent methods cannot
review, grant policy or receive. Browser buttons deliberately simulate all three
fixture identities, so a person controlling this lab can exercise all roles. The
HTTP role dispatch is NOT authentication and must never be mounted in production.
State is isolated in one synchronous server process; audit, decisions, retry keys,
policies and receipts disappear together on restart. There is no claim of durable
idempotency, disaster recovery or production tenant security for this lab.

A production extension should retain the four responsibilities above:

- Detection reads server-owned stock at a committed revision; strictly below
  threshold is low, equality is sufficient. Reconciliation computes target minus
  projected stock using confirmed inbound and outstanding accepted shipments;
  pending/rejected proposals are not inbound. Never infer receipts from an order.
- Review Coordination requests a new human decision per proposal unless a separate
  authorized human has granted a valid standing policy. Persist tenant, SKU,
  location, supplier, currency, quantity/value caps, aggregate period budget,
  expiry, revocation and version. Agents cannot write policies, assign roles,
  impersonate reviewers or pass broader authority through a handoff.
- Inventory Action must recheck policy, budget and inventory revision under the
  tenant lock at execution, with immutable approved proposal fingerprints. Human
  approval must identify quantity, price and supplier; any change requires review.
  Unknown price, ambiguous stock, missing policy, expiration, revoked authority,
  exhausted budget or integration failure must hold for a human, never auto-escalate.
- Add separate forced-RLS policy/proposal/receipt tables, narrow service grants,
  session-derived tenant/actor and audit in the existing transaction model.
  Use a unique tenant/location/SKU/detection-revision key, durable request
  fingerprints and one active proposal per scope. Reserve budget atomically.
  Audit blocked actions and decisions with policy version and evidence references.
- If separately authorized in future, use a transactional outbox and supplier
  idempotency key for external orders. A timeout is uncertain: query/reconcile the
  same key, never create another order silently. Missing provider idempotency
  requires manual recovery. Production receipts require trusted receiving evidence
  and their own unique key. Keep proposed, ordered, inbound and received distinct.

No hosted migrations, permissions, credentials, existing branches, main, deployments
or production data were changed. Existing PR release gates remain outside this work.
