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
