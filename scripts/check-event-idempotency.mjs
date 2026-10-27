// Event-level idempotency checks for the Detection intake path, run against the
// repository's isolated embedded PostgreSQL (same setup as check-database.mjs).
// Each scenario records its expected behavior and the actual result; a failing
// scenario does not stop the remaining scenarios.
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { localPostgres, provisionTenant, secret } from './lib/local-postgres.mjs';
import { createPool, verifyRuntime } from '../server/db/pool.js';
import { PostgresStore } from '../server/db/store.js';
import { tokenHash } from '../server/security.js';
import { createSecureHandler } from '../server/secure-handler.js';
import { canonicalJson } from '../server/agents/contracts.js';

await mkdir('work', { recursive: true });
const dir = await mkdtemp(resolve('work/test-event-idem-'));
let local, pool, server;
const results = [];
let failedCount = 1; // stays non-zero unless every scenario ran and passed

const describeError = (error) => ({ message: error?.message, code: error?.code, constraint: error?.constraint, statusCode: error?.statusCode });
const attempt = async (fn) => {
  try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error: describeError(error) }; }
};
const show = (r) => JSON.stringify(r.ok ? { accepted: true, duplicate: r.value.duplicate } : { accepted: false, ...r.error });
const reorder = (value) => Array.isArray(value) ? value.map(reorder)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reorder(value[key])]))
    : value;

const only = (process.env.SCENARIOS ?? '').split(',').map((token) => token.trim()).filter(Boolean);
async function scenario(name, expected, body) {
  if (only.length && !only.includes(name.split(' ')[0].replace(/\.$/, ''))) return;
  const checks = [];
  const check = (label, ok, actual) => checks.push({ label, ok: Boolean(ok), actual });
  try { await body(check); } catch (error) {
    checks.push({ label: 'scenario completed without an unexpected exception', ok: false, actual: JSON.stringify(describeError(error)) });
  }
  const ok = checks.every((entry) => entry.ok);
  results.push({ name, expected, ok, checks });
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${name}\n  expected: ${expected}`);
  for (const entry of checks) console.log(`  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.label}\n         actual: ${entry.actual}`);
}

try {
  local = await localPostgres(dir, Number(process.env.TEST_DB_PORT ?? 55441));
  const worker = { id: 'worker', name: 'Trusted worker', role: 'worker', token: secret() };
  const reviewer = { id: 'reviewer', name: 'Trusted reviewer', role: 'reviewer', token: secret() };
  await provisionTenant(local.owner, 'one', [worker, reviewer]);
  pool = createPool(local.runtimeUrl); await verifyRuntime(pool);
  const store = new PostgresStore(pool);
  const hash = tokenHash(worker.token);
  const reviewerHash = tokenHash(reviewer.token);
  const execute = (path, body) => store.execute(hash, path, { requestId: randomUUID(), ...body });

  const added = await execute('inventory', { operation: 'add', expectedRevision: 0, item: { name: 'Idempotency item', count: 8, location: 'A' } });
  const itemId = added.inventory.inventoryItems[0].id;
  const timestamp = '2026-10-26T12:00:00.000Z';
  const event = (id, quantity = 5) => ({
    eventId: id, occurredAt: timestamp, source: 'synthetic/idempotency-test', type: 'inventory-count-observed', itemId, observedQuantity: quantity,
    evidence: [{ id: `sheet-${id}`, kind: 'manual-count-sheet', description: `Synthetic ${quantity} units`, observedAt: timestamp, observedQuantity: quantity }],
  });
  const intake = (payload, requestId = randomUUID()) => store.execute(hash, 'workflow', { requestId, stage: 'intake', event: payload });
  const eventRows = async (id) => (await local.owner.query("SELECT id, document FROM lookout.events WHERE tenant_id='one' AND id=$1", [id])).rows;

  server = createServer(createSecureHandler(store, (_req, res) => res.writeHead(404).end()));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${worker.token}`, 'Content-Type': 'application/json' };

  await scenario('1. Same event ID, identical payload, submitted twice (new requestId each time)',
    'first accepted as new; second accepted as an ordinary duplicate (duplicate:true), no error; exactly one events row',
    async (check) => {
      const id = 'idem-identical';
      const first = await attempt(() => intake(event(id)));
      const second = await attempt(() => intake(event(id)));
      const rows = await eventRows(id);
      check('first submission accepted as new', first.ok && first.value.duplicate === false, show(first));
      check('second submission accepted as ordinary duplicate', second.ok && second.value.duplicate === true, show(second));
      check('exactly one row in lookout.events', rows.length === 1, `rows=${rows.length}`);
      check('informational: key order of the stored JSONB vs the payload sent', true,
        `payload=${Object.keys(event(id)).join(',')} | stored=${Object.keys(rows[0]?.document ?? {}).join(',')}`);
      const requestId = randomUUID();
      await attempt(() => intake(event(`${id}-control`), requestId));
      const replay = await attempt(() => intake(event(`${id}-control`), requestId));
      check('control: replaying the SAME requestId returns the cached response (duplicate:true)', replay.ok && replay.value.duplicate === true, show(replay));
    });

  await scenario('2. Same event ID, different quantity (5 then 6, each internally consistent)',
    "second rejected as a conflicting payload with message 'conflicting event data' (not a raw unique-violation, not silently a duplicate); stored event still 5; HTTP 409 with the same message",
    async (check) => {
      const id = 'idem-conflict-qty';
      const first = await attempt(() => intake(event(id, 5)));
      const second = await attempt(() => intake(event(id, 6)));
      const rows = await eventRows(id);
      check('first submission accepted', first.ok && first.value.duplicate === false, show(first));
      check('different quantity rejected', !second.ok, show(second));
      check("rejection names 'conflicting event data'", !second.ok && /conflicting event data/.test(second.error.message), show(second));
      check('rejection is not a raw PostgreSQL unique violation (23505)', !second.ok && second.error.code !== '23505', show(second));
      check('stored event unchanged (one row, observedQuantity 5)', rows.length === 1 && rows[0].document.observedQuantity === 5,
        `rows=${rows.length} observedQuantity=${rows[0]?.document?.observedQuantity}`);
      const response = await fetch(`${base}/api/agent/workflow`, { method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID(), stage: 'intake', event: event(id, 7) }) });
      const body = await response.json();
      check("HTTP: 409 and a message that says 'conflicting event data'", response.status === 409 && /conflicting event data/.test(body.error ?? ''), `status=${response.status} body=${JSON.stringify(body)}`);
    });

  await scenario('3. Two concurrent submissions, same event ID and identical payload',
    'both settle without error; exactly one is new and one is duplicate:true; exactly one events row; no unique-violation leaks',
    async (check) => {
      const id = 'idem-concurrent-identical';
      const settled = await Promise.all([attempt(() => intake(event(id))), attempt(() => intake(event(id)))]);
      const rows = await eventRows(id);
      check('both submissions accepted (no error)', settled.every((r) => r.ok), settled.map(show).join(' | '));
      check('exactly one new and one duplicate', settled.filter((r) => r.ok && r.value.duplicate === false).length === 1
        && settled.filter((r) => r.ok && r.value.duplicate === true).length === 1, settled.map(show).join(' | '));
      check('no raw unique violation surfaced', settled.every((r) => r.ok || r.error.code !== '23505'), settled.map(show).join(' | '));
      check('exactly one row in lookout.events', rows.length === 1, `rows=${rows.length}`);
    });

  await scenario('3b. (extra) Two concurrent submissions, same event ID, DIFFERENT quantities',
    "exactly one accepted as new; the other rejected with 'conflicting event data' (not a raw 23505); one events row",
    async (check) => {
      const id = 'idem-concurrent-conflict';
      const settled = await Promise.all([attempt(() => intake(event(id, 5))), attempt(() => intake(event(id, 6)))]);
      const rows = await eventRows(id);
      const accepted = settled.filter((r) => r.ok);
      const rejected = settled.filter((r) => !r.ok);
      check('exactly one accepted as new', accepted.length === 1 && accepted[0].value.duplicate === false, settled.map(show).join(' | '));
      check("the other is rejected with 'conflicting event data'", rejected.length === 1 && /conflicting event data/.test(rejected[0].error.message), settled.map(show).join(' | '));
      check('no raw unique violation surfaced', settled.every((r) => r.ok || r.error.code !== '23505'), settled.map(show).join(' | '));
      check('exactly one row in lookout.events', rows.length === 1, `rows=${rows.length}`);
    });

  await scenario('4. Same event ID and same content, but object keys in a different order',
    'treated as an ordinary duplicate (duplicate:true), not as a conflict; one events row',
    async (check) => {
      const id = 'idem-key-order';
      const original = event(id);
      const reordered = reorder(original);
      check('sanity: the reordered payload really has different key order', JSON.stringify(Object.keys(original)) !== JSON.stringify(Object.keys(reordered)),
        `original=${Object.keys(original).join(',')} | reordered=${Object.keys(reordered).join(',')}`);
      const first = await attempt(() => intake(original));
      const second = await attempt(() => intake(reordered));
      const rows = await eventRows(id);
      check('original-order submission accepted as new', first.ok && first.value.duplicate === false, show(first));
      check('reordered submission accepted as ordinary duplicate', second.ok && second.value.duplicate === true, show(second));
      check('exactly one row in lookout.events', rows.length === 1, `rows=${rows.length}`);
      const idB = 'idem-key-order-reversed-first';
      const firstB = await attempt(() => intake(reorder(event(idB))));
      const secondB = await attempt(() => intake(event(idB)));
      check('reversed order first, then original order: accepted as new then ordinary duplicate', firstB.ok && firstB.value.duplicate === false && secondB.ok && secondB.value.duplicate === true,
        `${show(firstB)} | ${show(secondB)}`);
    });

  await scenario('5. Same event ID, one meaningful field changed (through the database round trip)',
    "every variant (and its reordered-keys twin) rejected with 'conflicting event data' and never a raw 23505; the stored event is unchanged afterwards",
    async (check) => {
      const id = 'idem-fields';
      const base = event(id);
      const evidence = base.evidence[0];
      const first = await attempt(() => intake(base));
      check('baseline accepted as new', first.ok && first.value.duplicate === false, show(first));
      const stored = (await eventRows(id))[0].document;
      const variants = {
        'quantity 6 (evidence kept consistent)': { ...base, observedQuantity: 6, evidence: [{ ...evidence, observedQuantity: 6 }] },
        'source': { ...base, source: 'synthetic/another-source' },
        'itemId': { ...base, itemId: 'some-other-item' },
        'itemId removed (null)': { ...base, itemId: null },
        'occurredAt': { ...base, occurredAt: '2026-10-26T12:00:01.000Z' },
        'evidence id': { ...base, evidence: [{ ...evidence, id: 'sheet-other' }] },
        'evidence kind': { ...base, evidence: [{ ...evidence, kind: 'photo' }] },
        'evidence description': { ...base, evidence: [{ ...evidence, description: 'Changed text' }] },
        'evidence observedAt': { ...base, evidence: [{ ...evidence, observedAt: '2026-10-26T12:00:01.000Z' }] },
        'extra evidence record': { ...base, evidence: [evidence, { ...evidence, id: 'sheet-extra' }] },
      };
      for (const [label, payload] of Object.entries(variants)) {
        for (const [form, candidate] of [['as sent', payload], ['keys reordered', reorder(payload)]]) {
          const result = await attempt(() => intake(candidate));
          check(`${label} (${form}): rejected as conflicting event data`,
            !result.ok && /conflicting event data/.test(result.error.message) && result.error.code !== '23505', show(result));
        }
      }
      const rows = await eventRows(id);
      check('stored event unchanged after all attempts', rows.length === 1 && canonicalJson(rows[0].document) === canonicalJson(stored), `rows=${rows.length}`);
    });

  await scenario('6. Five concurrent submissions, same event ID and identical payload',
    'exactly one accepted as new and four as ordinary duplicates; no errors; exactly one events row',
    async (check) => {
      const id = 'idem-concurrent-five';
      const settled = await Promise.all(Array.from({ length: 5 }, (_, index) => attempt(() => intake(index % 2 ? reorder(event(id)) : event(id)))));
      const rows = await eventRows(id);
      check('all five accepted (no error)', settled.every((r) => r.ok), settled.map(show).join(' | '));
      check('exactly one new and four duplicates', settled.filter((r) => r.ok && r.value.duplicate === false).length === 1
        && settled.filter((r) => r.ok && r.value.duplicate === true).length === 4, settled.map(show).join(' | '));
      check('exactly one row in lookout.events', rows.length === 1, `rows=${rows.length}`);
    });

  await scenario('6b. Four concurrent submissions: two with quantity 5 and two with quantity 6, same event ID',
    "one payload wins (accepted as new) and its twin is a duplicate; the other two are rejected as 'conflicting event data'; the stored quantity is the winner's; no raw 23505",
    async (check) => {
      const id = 'idem-concurrent-mixed';
      const settled = await Promise.all([5, 6, 5, 6].map((quantity) => attempt(() => intake(event(id, quantity))).then((r) => ({ quantity, ...r }))));
      const rows = await eventRows(id);
      const winner = settled.find((r) => r.ok && r.value.duplicate === false);
      check('exactly one accepted as new', settled.filter((r) => r.ok && r.value.duplicate === false).length === 1, settled.map((r) => `${r.quantity}:${show(r)}`).join(' | '));
      check('the winning payload\'s twin is an ordinary duplicate', Boolean(winner) && settled.filter((r) => r.ok && r.value.duplicate === true && r.quantity === winner.quantity).length === 1, settled.map((r) => `${r.quantity}:${show(r)}`).join(' | '));
      check("both submissions of the other payload are rejected as 'conflicting event data'",
        Boolean(winner) && settled.filter((r) => !r.ok && r.quantity !== winner.quantity && /conflicting event data/.test(r.error.message)).length === 2, settled.map((r) => `${r.quantity}:${show(r)}`).join(' | '));
      check('no raw unique violation surfaced', settled.every((r) => r.ok || r.error.code !== '23505'), settled.map((r) => `${r.quantity}:${show(r)}`).join(' | '));
      check("stored event holds the winner's quantity (one row)", rows.length === 1 && rows[0].document.observedQuantity === winner?.quantity, `rows=${rows.length} stored=${rows[0]?.document?.observedQuantity} winner=${winner?.quantity}`);
    });

  await scenario('7. Database backstop: a second row for the same tenant and event ID',
    'PostgreSQL rejects it with unique violation 23505 on the events primary key; still exactly one row (the application never needs to treat 23505 as a duplicate)',
    async (check) => {
      const id = 'idem-pk-backstop';
      await attempt(() => intake(event(id)));
      const direct = await attempt(() => local.owner.query("INSERT INTO lookout.events(tenant_id,id,item_id,document) VALUES('one',$1,$2,$3)", [id, itemId, event(id)]));
      check('direct second INSERT is rejected with code 23505', !direct.ok && direct.error.code === '23505', JSON.stringify(direct.ok ? 'inserted' : direct.error));
      check('the violated constraint is the events primary key', !direct.ok && direct.error.constraint === 'events_pkey', JSON.stringify(direct.ok ? 'inserted' : direct.error));
      check('still exactly one row', (await eventRows(id)).length === 1, `rows=${(await eventRows(id)).length}`);
    });

  await scenario('8. Audit of store.js:107 (JSON.stringify of inventory): non-mutating operations must not bump the inventory revision',
    'intake, duplicate intake (new requestId, original and reordered keys), reconcile, duplicate reconcile, review and a duplicate action leave the revision unchanged; the single real action bumps it by exactly 1',
    async (check) => {
      const id = 'idem-revision-audit';
      const revision = async () => (await store.read(hash)).revision;
      const start = await revision();
      const steps = [];
      const record = async (label, fn) => { const r = await attempt(fn); steps.push({ label, r, after: await revision() }); return r; };
      await record('intake (new)', () => intake(event(id)));
      await record('intake duplicate (new requestId)', () => intake(event(id)));
      await record('intake duplicate (reordered keys)', () => intake(reorder(event(id))));
      const reconciled = await record('reconcile (new)', () => execute('workflow', { stage: 'reconcile', eventId: id }));
      await record('reconcile duplicate (new requestId)', () => execute('workflow', { stage: 'reconcile', eventId: id }));
      const caseId = reconciled.ok ? reconciled.value.caseRecord.caseId : `case:${id}`;
      await record('review (approve)', () => store.execute(reviewerHash, 'workflow', { requestId: randomUUID(), stage: 'review', caseId, decision: { decisionId: `decision-${id}`, outcome: 'approve', rationale: 'Evidence checked' } }));
      const beforeAction = await revision();
      const action = await record('action (the one real inventory change)', () => execute('workflow', { stage: 'action', caseId, request: { actionRequestId: `action-${id}` } }));
      const afterAction = steps.at(-1).after;
      await record('action duplicate (new requestId)', () => execute('workflow', { stage: 'action', caseId, request: { actionRequestId: `action-${id}` } }));
      steps.slice(0, 6).forEach(({ label, r, after }) => check(`${label}: revision unchanged at ${start}`, r.ok && after === start, `${show(r)} revision=${after}`));
      check('action: accepted, revision increased by exactly 1', action.ok && action.value.duplicate === false && afterAction === beforeAction + 1, `${show(action)} revision ${beforeAction} -> ${afterAction}`);
      const last = steps.at(-1);
      check('action duplicate (new requestId): accepted as duplicate, revision unchanged', last.r.ok && last.r.value.duplicate === true && last.after === afterAction, `${show(last.r)} revision=${last.after}`);
    });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} scenarios passed; failed: ${failed.map((r) => r.name.split('.')[0]).join(', ') || 'none'}`);
  failedCount = failed.length + (results.length === 0 ? 1 : 0);
} catch (error) {
  console.error(error);
  failedCount = 1;
} finally {
  if (server) await new Promise((done) => server.close(done));
  await pool?.end(); await local?.owner.end(); await local?.db.stop(); await rm(dir, { recursive: true, force: true });
}
// Exit explicitly after teardown. Setting process.exitCode alone was observed to be
// overridden: a process.exit(0) is called after the script finishes (origin not found in
// this repository or its dependencies), so the exit code is passed to process.exit directly.
process.exit(failedCount ? 1 : 0);
