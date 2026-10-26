import { randomUUID, createHash } from 'node:crypto';
import { addInventoryItem, restockInventoryItem, beginRestock, reconcileTask } from '../../inventory.js';
import { intakeStoreEvent } from '../agents/event-intake.js';
import { reconcileStoreEvent } from '../agents/inventory-reconciliation.js';
import { coordinateHumanReview } from '../agents/review-coordination.js';
import { executeInventoryAction } from '../agents/inventory-action.js';
import { createAgentInventoryContext } from '../agent-context.js';
import { requireIdentifier } from '../agents/contracts.js';
import { authorize, fail } from '../security.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export class PostgresStore {
  constructor(pool) { this.pool = pool; }
  async transaction(hash, operation) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The same unguessable session digest selects identity AND the RLS context.
      // Caller-supplied tenant IDs and the old tenant setting cannot establish authority.
      await client.query("SELECT set_config('lookout.session_hash',$1,true)", [hash]);
      const { rows: [identity] } = await client.query('SELECT * FROM lookout.session_principal($1)', [hash]);
      if (!identity) throw fail(401, 'Sign in required.');
      const result = await operation(client, identity);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async state(client, tenant) {
    // One lock serializes inventory + four-stage transitions within a tenant.
    const { rows: [row] } = await client.query('SELECT document, revision FROM lookout.inventory WHERE tenant_id=$1 FOR UPDATE', [tenant]);
    if (!row) throw fail(503, 'Tenant inventory is not provisioned.');
    const workflow = { version: 1 };
    for (const table of ['events', 'cases', 'actions']) {
      const { rows } = await client.query(`SELECT document FROM lookout.${table} WHERE tenant_id=$1 ORDER BY id`, [tenant]);
      workflow[table] = rows.map(r => r.document);
    }
    return { inventory: row.document, revision: Number(row.revision), workflow };
  }
  async read(hash) {
    return this.transaction(hash, async (client, principal) => {
      authorize(principal, 'read');
      const state = await this.state(client, principal.tenant_id);
      return { ...state, identity: { id: principal.id, name: principal.name, role: principal.role } };
    });
  }
  async execute(hash, path, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Request must be an object.');
    const operation = path === 'inventory' ? input.operation : input.stage;
    return this.transaction(hash, async (client, principal) => {
      authorize(principal, operation);
      if (path === 'inventory' && !['add', 'receive', 'begin', 'finish'].includes(operation)
        || path === 'workflow' && !['intake', 'reconcile', 'review', 'action'].includes(operation)) throw fail(400, 'Unknown operation.');
      const requestId = requireIdentifier(input.requestId, 'requestId');
      const tenant = principal.tenant_id;
      const state = await this.state(client, tenant);
      const digest = fingerprint({ path, input });
      const { rows: [prior] } = await client.query('SELECT fingerprint,response FROM lookout.requests WHERE tenant_id=$1 AND actor_id=$2 AND id=$3', [tenant, principal.id, requestId]);
      if (prior) {
        if (prior.fingerprint !== digest) throw fail(409, 'requestId was already used for different input.');
        return { ...prior.response, duplicate: true };
      }
      let { inventory, workflow, revision } = state;
      let result;
      if (path === 'inventory') {
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== revision) throw fail(409, 'Stale inventory revision. Reload and retry.');
        if (operation === 'add') inventory = addInventoryItem(inventory, input.item ?? {});
        if (operation === 'receive') inventory = restockInventoryItem(inventory, input.itemId, input.quantity);
        if (operation === 'begin') inventory = beginRestock(inventory, input.itemId, input.quantity);
        if (operation === 'finish') inventory = reconcileTask(inventory, input.taskId, input.outcome);
        result = { duplicate: false };
      } else {
        if (Object.hasOwn(input, 'inventory')) throw fail(400, 'Inventory is server-owned; omit inventory snapshots.');
        if (operation === 'intake') result = intakeStoreEvent(input.event, workflow);
        if (operation === 'reconcile') result = reconcileStoreEvent(input.eventId, inventory, workflow);
        if (operation === 'review') {
          const decision = { ...input.decision, reviewerId: principal.id, reviewerName: principal.name };
          // Reviewer timestamps, like identity, originate at the server.
          delete decision.decidedAt;
          result = coordinateHumanReview(input.caseId, decision, workflow);
        }
        if (operation === 'action') {
          const record = workflow.cases.find(c => c.caseId === input.caseId);
          if (record?.review?.reviewerId === principal.id) throw fail(403, 'Reviewer cannot execute their own approval.');
          result = executeInventoryAction(input.caseId, input.request, inventory, workflow);
          inventory = result.inventory;
        }
        workflow = result.workflow;
      }
      const inventoryChanged = JSON.stringify(inventory) !== JSON.stringify(state.inventory);
      if (inventoryChanged) {
        revision++;
        if (!Number.isSafeInteger(revision)) throw fail(409, 'Inventory revision limit reached.');
        await client.query('UPDATE lookout.inventory SET document=$2, revision=$3 WHERE tenant_id=$1', [tenant, inventory, revision]);
        for (const location of inventory.locations) await client.query('INSERT INTO lookout.locations(tenant_id,id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [tenant, location.id, location.name]);
        for (const item of inventory.inventoryItems) await client.query(`INSERT INTO lookout.items(tenant_id,id,location_id,name,quantity) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(tenant_id,id) DO UPDATE SET quantity=EXCLUDED.quantity`, [tenant, item.id, item.locationId, item.name, item.quantityOnHand]);
      }
      for (const event of workflow.events) {
        if (!state.workflow.events.some(e => e.eventId === event.eventId)) await client.query('INSERT INTO lookout.events(tenant_id,id,item_id,document) VALUES($1,$2,$3,$4)', [tenant, event.eventId, event.itemId, event]);
      }
      for (const record of workflow.cases) {
        await client.query(`INSERT INTO lookout.cases(tenant_id,id,event_id,document) VALUES($1,$2,$3,$4)
          ON CONFLICT(tenant_id,id) DO UPDATE SET document=EXCLUDED.document`, [tenant, record.caseId, record.eventId, record]);
        const old = state.workflow.cases.find(c => c.caseId === record.caseId);
        for (const review of record.reviewHistory) {
          if (!old?.reviewHistory.some(r => r.decisionId === review.decisionId)) await client.query('INSERT INTO lookout.reviews(tenant_id,id,case_id,reviewer_id,document) VALUES($1,$2,$3,$4,$5)', [tenant, review.decisionId, record.caseId, principal.id, review]);
        }
      }
      for (const action of workflow.actions) {
        if (!state.workflow.actions.some(a => a.actionRequestId === action.actionRequestId)) await client.query('INSERT INTO lookout.actions(tenant_id,id,case_id,item_id,document) VALUES($1,$2,$3,$4,$5)', [tenant, action.actionRequestId, action.caseId, action.itemId, action]);
      }
      const response = { ...result, inventory, workflow, revision, context: createAgentInventoryContext(inventory) };
      await client.query('INSERT INTO lookout.requests(tenant_id,actor_id,id,fingerprint,response) VALUES($1,$2,$3,$4,$5)', [tenant, principal.id, requestId, digest, response]);
      await client.query('INSERT INTO lookout.audit(tenant_id,id,actor_id,request_id,operation,document) VALUES($1,$2,$3,$4,$5,$6)', [tenant, randomUUID(), principal.id, requestId, operation, { revision, duplicate: result.duplicate, caseId: input.caseId ?? result.caseRecord?.caseId ?? null }]);
      return response;
    });
  }
}
