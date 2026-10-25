# Lookout

Lookout is an inventory visibility and reconciliation prototype. This first phase is deterministic and runs locally in a browser.

## Run it

Requires Node.js 22.21 or newer. From this folder:

1. Run `npm start`.
2. Open the local address printed in the terminal (by default `http://127.0.0.1:4173`).
3. Add an item using its real recorded unit count and storage location.
4. Begin a shelf restock. The selected quantity is subtracted immediately and a task appears with the remaining-units calculation.
5. Choose **Returned** to add those units back, or **Shelf restocked** to complete the task while keeping the deduction.

Inventory records and task history are stored in this browser on this device. Clearing this browser's site data removes them. This prototype does not yet synchronize between devices or estimate fulfillment timing.

## Phase 3 inventory model

The browser keeps four related records: inventory items (name, location reference, and units on hand), locations (reusable names), restock tasks (item/location snapshots, quantity before and after, and pending/returned/shelf-restocked status), and activity entries (a separate history of additions and task actions). Reusing a location name links another inventory item to the same location.

On first load after this model update, earlier Phase 1 records are converted in place and the original saved text is retained in this browser under `lookout.inventory.v1.before-phase-3`. The current `lookout.inventory.v1` key stays local to this browser; no database or network sync is added. Restock tasks describe only shelf replenishment. Store detection and investigation, including theft review or reinstatement, are separate future workflows and are not modeled by these task statuses.

## Verify inventory rules

Run `npm test` to exercise the deterministic inventory and reconciliation rules with Node's built-in test runner.

## Phase 5 agent context API

`POST /api/agent/context` accepts a JSON body containing the complete Phase 3 inventory state (`schemaVersion: 2` with `inventoryItems`, `locations`, `restockTasks`, and `activity` arrays). It returns only `{ items, pendingTasks, recentActivity }`: item stock and location, pending shelf-restock tasks, and up to 20 recent activity records. The endpoint is read-only and does not call an AI provider. It returns `405` for other methods, `415` for a non-JSON content type, `400` for malformed JSON or unsupported/invalid inventory, and `413` when the request exceeds 1 MB. Successful responses use `application/json`.

Run `npm run demo:agent-context` to exercise the same route handler in-process without opening a network port. The demo uses sample inventory and prints the response. `ANTHROPIC_API_KEY` remains optional and server-side; Phase 5 does not send it anywhere or expose it to browser assets.

## Phase 6 four-agent workflow

Phase 6 adds a deterministic workflow service with four separate, validated responsibilities. No Anthropic SDK or live model call is installed or used. The endpoint accepts one stage at a time at `POST /api/agent/workflow`; its request body is JSON, limited to 1 MB. `GET /api/agent/workflow` returns the current in-process workflow ledger.

Stages and contracts:

1. `intake`: `{ "stage": "intake", "event": { "eventId", "occurredAt", "source", "type": "inventory-count-observed", "itemId", "observedQuantity", "evidence": [{ "id", "kind", "description", "observedAt", "observedQuantity?" }] } }`. IDs and timestamps are preserved. `itemId` and `observedQuantity` may be `null` to represent unknowns. Evidence is required, and any reported count must match a count explicitly recorded in at least one evidence record. Repeating the same event ID and data is idempotent; conflicting reuse is rejected.
2. `reconcile`: `{ "stage": "reconcile", "eventId", "inventory": <Phase 3 inventory state> }`. It returns a stable `case:<eventId>` case with observed facts, inferences, unknowns, evidence links, a review requirement, and—only for an evidenced count variance—a proposed set-count action. It never infers theft or the cause of a variance.
3. `review`: `{ "stage": "review", "caseId", "decision": { "decisionId", "reviewerId", "reviewerName", "outcome", "rationale", "decidedAt?" } }`. Outcomes are `approve`, `reject`, or `request-more-information`. An approval is accepted only for an unresolved case with a supported action. Cases needing information can be routed for it but cannot be approved without an evidence-backed action. A follow-up decision after a request for information is appended to review history.
4. `action`: `{ "stage": "action", "caseId", "request": { "actionRequestId" }, "inventory": <current Phase 3 inventory state> }`. Only a case approved through the same running server workflow can execute. Current item quantity and activity revision are rechecked. Repeating an action request returns its saved result; stale or conflicting requests are rejected. A verified count adjustment uses the deterministic inventory mutation and writes an auditable `inventory-count-adjusted` activity record. Its event, case, request, reviewer, count, and evidence references are included in subsequent context reads.

Successful stage responses include the current workflow ledger. Validation errors return `400`; missing/unsupported media types return `415`; unapproved actions return `403`; duplicate conflicts or stale inventory return `409`. Workflow event, case, review, and action state is held in server memory for the lifetime of that server process. The action response also includes the updated inventory and context; a caller must save that inventory using the existing `saveInventoryState` convention for it to survive browser/server restarts. Existing browser inventory and restock persistence remains in `lookout.inventory.v1` on that browser/device.

Run `npm run demo:agent-workflow` for a complete, port-free scenario. All demo input is explicitly synthetic: it records a manual count of five against eight recorded units, leaves the variance's cause unknown, records an explicit sample human approval, applies the corrected count, and reads the resulting audit entry through the Phase 5 context builder.

This is a local prototype, not a production authorization or persistence system. The server binds to loopback and has no user authentication, so reviewer IDs/names are supplied by the caller and must not be treated as verified identities. Workflow state is lost on server restart, browser tabs do not share or lock local inventory, and the API has no durable database, role-based access control, external evidence verification, or live AI integration. Production deployment needs authenticated reviewer identity, durable transactional storage and idempotency, concurrency controls, evidence-source verification, and security review before any inventory actions are enabled.

## Environment configuration

At startup, the server reads a local `.env` file when one exists. `.env.example` documents `PORT` and the future server-side Anthropic key setting. `.env`, `.env.*`, and other local environment files are ignored by Git; `.env.example` is the only exception. No `.env` file or Anthropic key is needed for this phase.

`PORT` must be a whole number from 1 to 65535; it defaults to `4173`. The optional Anthropic key is read only by the server configuration module. The app does not use the key yet, and the static web server serves only its explicit list of browser files, not `.env` or server source. When a later phase adds an API route, create `.env` locally and enter the key there; do not put it in browser code, commits, screenshots, or chat.

Node's built-in `.env` loader is used, so no environment package or API integration is installed in this phase.


## Development Notes

Testing my first README update commit.

## Agent Operations dashboard and direct API checks

The localhost home page now exposes all four deterministic Phase 6 stages, explicit synthetic count evidence, human approval/rejection, and a separate approved inventory action with audit details. Existing inventory and restock controls remain available.

See [the browser and API walkthrough](docs/agent-operations.md) for exact curl requests, expected statuses, and prototype authorization/persistence limits.

```sh
npm run test:agent-api
npm run test:agent-api -- --url http://127.0.0.1:4174
npm run api:fixtures
```
