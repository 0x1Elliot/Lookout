# Lookout: Demo Verification Notes

## Demo Mode: Verified Behavior

OBSERVED: Lookout was tested in a fresh scratch copy at commit `4e0b653` using a fictional inventory event for `SAMPLE-ITEM-1`. The event had a recorded quantity of 8 and an observed quantity of 5. The event completed all four stages, and the responses matched the expected outcomes.

READ: The browser sends a separate request to each stage rather than triggering one fully automated, server-side workflow.

READ: In demo mode, events, cases, and actions are held in memory.

OBSERVED: The caller supplies the inventory snapshot when required, and the demo server returns the updated inventory in the action response.

OBSERVED: Case IDs use the format `case:<eventId>`. The test produced the case ID `case:readme-evt-1`. The workflow state endpoint, `GET /api/agent/workflow`, was also called during the test.

Example requests for each stage are not yet included.

## Running the Demo

OBSERVED: The demo server was started on port 4175 using:

```bash
PORT=4175 npm run start:demo

```

OBSERVED: In that test, the server bound to `127.0.0.1`. The workflow endpoint was accessed at:

```text
http://127.0.0.1:4175/api/agent/workflow

```

READ: The project specifies Node.js 24.x in its package configuration.

UNKNOWN: Node.js 24.x compatibility has not been verified by this demo test. Dependency installation, the build, secure mode, and the database-backed path were not tested as part of this verification.

## Scope and Limitations

BY DESIGN: Lookout demonstrates inventory-event processing with simulated data. It does not connect to live POS, ERP, or warehouse systems and does not modify real store inventory.

OBSERVED: In demo mode at commit `4e0b653`, a conflicting duplicate event was rejected with an HTTP 409 response and was not recorded for later review.

READ: The implementation processes individual events through separate stage requests. The Orchestrator, batches, and run IDs described in the original design are not implemented in the tested version.

OBSERVED: In the sample run, the same reviewer ID was used to approve and apply the adjustment in demo mode.

READ: The source contains a separate-approver check in secure mode.

UNKNOWN: Secure-mode behavior, database-backed behavior, production database permissions, and production readiness have not been verified by this demo test.

## Addendum: Duplicate Events on Current `main`

OBSERVED: The demo workflow was re-run in a fresh scratch copy of `main` at commit `f53ef52` (after PRs #6, #7, #8, and #10 were merged), using the same fictional event for `SAMPLE-ITEM-1`. All four stages completed and matched the expected outcomes: recorded quantity 8, observed quantity 5, case `case:readme-evt-1`, final inventory 5, and one recorded action.

OBSERVED: On `f53ef52`, sending the identical event again returned HTTP 200 with `duplicate: true`. No second event was recorded.

OBSERVED: On `f53ef52`, sending the same event with its object keys in a different order also returned HTTP 200 with `duplicate: true`, and no second event was recorded.

OBSERVED: On `f53ef52`, sending an event with the same `eventId` but different content (observed quantity 4 instead of 5) was rejected with HTTP 409 and the message `eventId already exists with conflicting event data.` The stored state did not change.

READ: At commit `4e0b653`, duplicate events were compared with `JSON.stringify`, so key order mattered. On `main`, the comparison sorts object keys first (`canonicalJson` in `server/agents/contracts.js`). Array order is still significant.

UNKNOWN: The key-reordered case was not re-run at `4e0b653`, so its behavior there is taken from the source and not from a run.

UNKNOWN: This re-run used reused dependencies and Node.js v26.7.0. Dependency installation, the build, the test suite, Node.js 24.x, secure mode, and the database-backed path were not tested.
