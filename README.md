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

## Verify inventory rules

Run `npm test` to exercise the deterministic inventory and reconciliation rules with Node's built-in test runner.

## Environment configuration

At startup, the server reads a local `.env` file when one exists. `.env.example` documents `PORT` and the future server-side Anthropic key setting. `.env`, `.env.*`, and other local environment files are ignored by Git; `.env.example` is the only exception. No `.env` file or Anthropic key is needed for this phase.

`PORT` must be a whole number from 1 to 65535; it defaults to `4173`. The optional Anthropic key is read only by the server configuration module. The app does not use the key yet, and the static web server serves only its explicit list of browser files, not `.env` or server source. When a later phase adds an API route, create `.env` locally and enter the key there; do not put it in browser code, commits, screenshots, or chat.

Node's built-in `.env` loader is used, so no environment package or API integration is installed in this phase.


## Development Notes

Testing my first README update commit.
