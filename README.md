# Lookout

Lookout is an inventory visibility and reconciliation prototype. This first phase is deterministic and runs locally in a browser.

## Run it

Requires Node.js 20 or newer. From this folder:

1. Run `npm start`.
2. Open the local address printed in the terminal (by default `http://127.0.0.1:4173`).
3. Add an item using its real recorded unit count and storage location.
4. Begin a shelf restock. The selected quantity is subtracted immediately and a task appears with the remaining-units calculation.
5. Choose **Returned** to add those units back, or **Shelf restocked** to complete the task while keeping the deduction.

Inventory records and task history are stored in this browser on this device. Clearing this browser's site data removes them. This prototype does not yet synchronize between devices or estimate fulfillment timing.

## Verify inventory rules

Run `npm test` to exercise the deterministic inventory and reconciliation rules with Node's built-in test runner.

## Environment configuration

`.env.example` documents the future server-side Anthropic key setting. Copy it to `.env` only when a later phase adds server-side API integration. `.env` is ignored by Git. Never expose an API key in browser code, screenshots, commits, or chat. No API key is needed for this phase.


## Development Notes

Testing my first README update commit.