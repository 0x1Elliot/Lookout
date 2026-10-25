import { Readable } from 'node:stream';
import { addInventoryItem, beginRestock, createEmptyInventoryState } from '../inventory.js';
import { createLookoutHandler } from '../server.mjs';

let inventory = addInventoryItem(createEmptyInventoryState(), {
  name: 'Blue notebooks', count: 8, location: 'Back room A',
});
inventory = beginRestock(inventory, inventory.inventoryItems[0].id, 3);

const request = Readable.from([JSON.stringify(inventory)]);
request.method = 'POST';
request.url = '/api/agent/context';
request.headers = { 'content-type': 'application/json' };

const response = {
  writeHead(statusCode, headers = {}) { this.statusCode = statusCode; this.headers = headers; },
  end(body = '') {
    console.log(`POST /api/agent/context → ${this.statusCode}`);
    console.log(JSON.stringify(JSON.parse(String(body)), null, 2));
  },
};

await createLookoutHandler()(request, response);
