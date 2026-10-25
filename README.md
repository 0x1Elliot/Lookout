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

## Environment configuration

At startup, the server reads a local `.env` file when one exists. `.env.example` documents `PORT` and the future server-side Anthropic key setting. `.env`, `.env.*`, and other local environment files are ignored by Git; `.env.example` is the only exception. No `.env` file or Anthropic key is needed for this phase.

`PORT` must be a whole number from 1 to 65535; it defaults to `4173`. The optional Anthropic key is read only by the server configuration module. The app does not use the key yet, and the static web server serves only its explicit list of browser files, not `.env` or server source. When a later phase adds an API route, create `.env` locally and enter the key there; do not put it in browser code, commits, screenshots, or chat.

Node's built-in `.env` loader is used, so no environment package or API integration is installed in this phase.


## Development Notes

Testing my first README update commit.
