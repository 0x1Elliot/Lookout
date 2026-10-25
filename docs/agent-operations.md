# Lookout Agent Operations — local walkthrough

Developed on `feature/agent-operations-dashboard` from Phase 6 `ceb840c`, following Phase 5 `fac4216` and Phase 4 `71e5802`. The repository remote is `https://github.com/0x1Elliot/Lookout.git`; ownership and authenticated admin access were verified before integration.

## Open the working dashboard

Use http://127.0.0.1:4174 for the walkthrough. Start a local server on that port if one is not already running.

To start it again:

```sh
cd /Users/elliotwatson/Lookout
PORT=4174 npm start
```

Keep that terminal open. Open the URL above. Browser inventory belongs to the exact origin: inventory saved on port 4173 will not automatically appear on port 4174.

1. In **Agent Operations**, click **Add sample item (8 units)**. This explicitly adds a synthetic sample to browser inventory.
2. Leave the synthetic observed count at **5**, then click **Run synthetic test event**.
3. Detection validates the synthetic count sheet. Reconciliation shows recorded 8, observed 5, variance −3, and cause unknown. Evidence references are shown. No count changes yet.
4. Enter your reviewer name and reason. Choose **Approve count**. Inventory still shows 8.
5. Click **Apply approved count to inventory**. Inventory now shows 5. **Activity history** records 8 → 5. Expand **Workflow and audit details** for event, case, reviewer, request, and evidence references.
6. To try rejection, add a new sample, run its count, enter your name/reason, then choose **Reject count**. That sample stays at 8; rejection appears in the case audit details. No inventory-change activity is created.
7. To try stale inventory, start and approve a new discrepancy, then use **Record items restocked** to add a unit before applying. Applying fails without replacing that restocked inventory. Start a **new test event** to use the current revision; re-reconciling the old event returns its existing case.

The dashboard displays the current session’s case. Reload preserves inventory/activity but starts a fresh dashboard session; previous server records are available with the GET command below until the server restarts.

## Automated API testing

In another terminal:

```sh
cd /Users/elliotwatson/Lookout
npm test
npm run demo:agent-context
npm run demo:agent-workflow
npm run test:agent-api
npm run test:agent-api -- --url http://127.0.0.1:4174
```

`test:agent-api` uses the real route handler in-process without a listening port. `--url` makes actual HTTP requests. The scenarios use isolated synthetic inventory snapshots; they do not update browser inventory. Each run uses fresh event IDs.

Verified: all 41 automated tests, both existing demos, and all 21 API scenario checks over real localhost HTTP. Browser verification confirmed approval/apply, rejection, persisted quantity after reload, audit activity, and no captured browser error/warning messages. The UI controller tests run against the actual API handler using a small DOM adapter; browser checks were performed separately.

## Exact curl commands

Run these **in order**, in one terminal, against the same running server. Fixtures contain synthetic counts, evidence, decisions, and a valid inventory snapshot. Generate fresh fixtures to repeat the sequence. Outputs include HTTP status followed by JSON. Most IDs in JSON vary per run.

```sh
cd /Users/elliotwatson/Lookout
npm run api:fixtures
LOOKOUT_URL=http://127.0.0.1:4174

# Read the in-memory workflow ledger: 200
curl -sS -w '\nHTTP %{http_code}\n' "$LOOKOUT_URL/api/agent/workflow"

# Malformed JSON: 400
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary '{' "$LOOKOUT_URL/api/agent/workflow"

# Invalid media type: 415
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: text/plain' --data '{}' "$LOOKOUT_URL/api/agent/workflow"

# Forged/nonexistent server case: 400 (not an authenticated identity check)
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/forged-action.json "$LOOKOUT_URL/api/agent/workflow"

# Valid Detection / intake: 200
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/intake.json "$LOOKOUT_URL/api/agent/workflow"

# Valid Reconciliation: 200, awaiting-review; proposed 8 -> 5
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/reconcile.json "$LOOKOUT_URL/api/agent/workflow"

# Action before approval: 403
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/action.json "$LOOKOUT_URL/api/agent/workflow"

# Unsupported reviewer outcome "auto-approve": 400
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/unsupported-outcome.json "$LOOKOUT_URL/api/agent/workflow"

# Unknown physical count: intake and reconciliation both 200
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/unknown-intake.json "$LOOKOUT_URL/api/agent/workflow"
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/unknown-reconcile.json "$LOOKOUT_URL/api/agent/workflow"

# Approval without a supported evidence-backed action: 400
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/unsupported-approval.json "$LOOKOUT_URL/api/agent/workflow"

# Human approval (self-reported identity): 200
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/review.json "$LOOKOUT_URL/api/agent/workflow"

# Changed inventory revision (restocked 8 -> 9): 409
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/stale-action.json "$LOOKOUT_URL/api/agent/workflow"

# Valid action with the original unchanged revision: 200, returned inventory is 5
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/action.json "$LOOKOUT_URL/api/agent/workflow"

# Identical action retry: 200, duplicate:true, no extra count adjustment
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/action.json "$LOOKOUT_URL/api/agent/workflow"

# Different action ID on the completed case: 409
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/new-action.json "$LOOKOUT_URL/api/agent/workflow"
```

For direct rejection testing, regenerate fixtures (fresh IDs), then run:

```sh
npm run api:fixtures
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/intake.json "$LOOKOUT_URL/api/agent/workflow"
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/reconcile.json "$LOOKOUT_URL/api/agent/workflow"
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/reject.json "$LOOKOUT_URL/api/agent/workflow"
# Rejected case action: 403
curl -sS -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' --data-binary @work/api-fixtures/action.json "$LOOKOUT_URL/api/agent/workflow"
```

## Implemented boundaries and remaining limits

- Four deterministic application stages connected to the existing Phase 6 service. No live sensors, Anthropic calls, LLM agents, or real physical evidence. No model key is needed.
- Explicit browser approval or rejection and separate application of the approved count. The browser saves returned inventory in its existing local storage and refreshes existing inventory/restock views. Storage failure leaves apply available to retry without issuing another action.
- API workflow cases, decisions, and action idempotency records are server memory only. Restart loses them; there is no durable case database or approval queue recovery in this increment.
- Existing stage rules require an approved case on the same server, compare supplied revisions, and prevent repeated actions. These are workflow constraints, **not production security**. There is no authenticated reviewer, role enforcement, tenant separation, or authoritative server inventory. A caller can self-report a reviewer and supply an old snapshot; the server cannot independently establish whether it is current.
- Direct API responses return inventory snapshots. They do not persist browser inventory or a shared inventory database. A duplicate retry returns the original action snapshot, not an authoritative current inventory.
- This remains a single-browser local prototype. Concurrent tabs/clients do not have transactional inventory synchronization. The dashboard refuses to overwrite inventory if its own in-memory snapshot changed while awaiting an action, but this is not cross-client concurrency control.
- Test/sample runs intentionally add synthetic items and audit history. Existing records and restock behavior are retained. These test runs do not deploy the application or call external model services.
