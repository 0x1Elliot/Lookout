import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountAgentDashboard } from './dashboard.js';

// Minimal DOM: just the calls dashboard.js makes, so the real controller runs unchanged.
class FakeElement {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.className = ''; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(' '); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
}
const fakeDocument = { createElement: (tag) => new FakeElement(tag), createElementNS: (_ns, tag) => new FakeElement(tag) };
const walk = (node, visit) => { visit(node); node.children.forEach((child) => walk(child, visit)); };
const cls = (node) => node.className || node.attributes.class || '';
const find = (root, predicate) => { const found = []; walk(root, (node) => { if (predicate(node)) found.push(node); }); return found; };

const sample = {
  workflow: { version: 1, actions: [], events: [{ eventId: 'e1', occurredAt: '2026-10-27T10:00:00.000Z', itemId: 'item-1', observedQuantity: 5 }],
    cases: [{ caseId: 'case:e1', eventId: 'e1', status: 'awaiting-review', discrepancyType: 'count-variance', unknowns: ['The cause of the count variance is unknown.'],
      proposedAction: { expectedQuantity: 8, targetQuantity: 5 }, review: null, reviewHistory: [] }] },
  inventory: { inventoryItems: [{ id: 'item-1', name: 'Notebooks' }], activity: [] },
};

const mount = (fetchWorkflow) => {
  const container = new FakeElement('div');
  const dashboard = mountAgentDashboard({ container, document: fakeDocument, fetchWorkflow, formatTime: (iso) => `at ${iso}` });
  return { container, dashboard };
};

test('shows a loading state, then real records beside clearly tagged demo examples', async () => {
  let release;
  const { container, dashboard } = mount(() => new Promise((resolve) => { release = resolve; }));
  assert.match(container.textContent, /Loading agent activity/);
  release(sample);
  await dashboard.started;
  const text = container.textContent;
  assert.match(text, /Demo data:/);
  assert.match(text, /Observed count differs from recorded inventory/);
  assert.match(text, /Recorded 8, observed 5/);
  assert.match(text, /Notebooks/);
  assert.match(text, /Detection/);
  assert.match(text, /Design name: Reconciliation & Response/);
  assert.match(text, /not been confirmed by Elliot/);
  const demoItems = find(container, (node) => /dash-(item|row)-demo/.test(node.className));
  assert.ok(demoItems.length >= 4);
  for (const item of demoItems) assert.match(item.textContent, /DEMO/);
  const realItems = find(container, (node) => node.className === 'dash-item' || node.className === 'dash-row');
  assert.ok(realItems.length >= 3);
  for (const item of realItems) assert.doesNotMatch(item.textContent, /DEMO/);
});

test('the demo toggle hides every demo item and updates the banner', async () => {
  const { container, dashboard } = mount(async () => sample);
  await dashboard.started;
  const toggle = find(container, (node) => node.tag === 'input')[0];
  toggle.checked = false;
  toggle.handlers.change();
  assert.equal(find(container, (node) => /dash-(item|row)-demo/.test(node.className)).length, 0);
  assert.match(container.textContent, /Demo examples are hidden/);
  assert.doesNotMatch(container.textContent, /evt-demo/);
});

test('an empty workflow shows empty states and "No data", not an idle status', async () => {
  const { container, dashboard } = mount(async () => ({ workflow: { events: [], cases: [], actions: [] } }));
  await dashboard.started;
  const text = container.textContent;
  assert.match(text, /No case in the current records needs attention\. Conflicts and rejected events are not recorded yet\./);
  assert.match(text, /No agent or inventory activity is recorded yet/);
  const statuses = find(container, (node) => node.className === 'dash-agent-status');
  assert.equal(statuses.length, 4);
  for (const status of statuses) {
    assert.match(status.textContent, /No data/);
    assert.doesNotMatch(status.textContent, /idle|processing|working/i);
  }
});

test('a failed load shows a safe error; a failed refresh keeps the last data', async () => {
  let fail = true;
  const { container, dashboard } = mount(async () => { if (fail) throw new Error('secret server detail'); return sample; });
  await dashboard.started;
  const alert = find(container, (node) => node.attributes.role === 'alert')[0];
  assert.equal(alert.hidden, false);
  assert.match(alert.textContent, /could not be loaded/);
  assert.doesNotMatch(container.textContent, /secret server detail/);
  fail = false;
  await dashboard.refresh();
  assert.equal(alert.hidden, true);
  assert.match(container.textContent, /Notebooks/);
  fail = true;
  await dashboard.refresh();
  assert.equal(alert.hidden, false);
  assert.match(alert.textContent, /Showing the last loaded data/);
  assert.match(container.textContent, /Notebooks/);
});

test('a malformed response is an error, and concurrent refreshes queue one follow-up request', async () => {
  let calls = 0;
  const { container, dashboard } = mount(async () => { calls++; return { unexpected: true }; });
  await dashboard.started;
  assert.match(container.textContent, /could not be loaded/);
  assert.equal(calls, 1);
  await Promise.all([dashboard.refresh(), dashboard.refresh()]);
  assert.equal(calls, 3);
});

const caseRecord = (eventId, status) => ({ caseId: `case:${eventId}`, eventId, status, discrepancyType: null, unknowns: [], proposedAction: null, review: null, reviewHistory: [] });
const withCases = (...statuses) => ({
  workflow: { version: 1, actions: [], events: statuses.map((_, index) => ({ eventId: `e${index}`, occurredAt: '2026-10-27T10:00:00.000Z', itemId: null, observedQuantity: null })),
    cases: statuses.map((status, index) => caseRecord(`e${index}`, status)) },
});
const chartOf = (container) => find(container, (node) => node.className === 'dash-chart')[0];

test('the donut shows real cases by the code’s status names, with every number repeated as text', async () => {
  const { container, dashboard } = mount(async () => withCases('awaiting-review', 'awaiting-review', 'completed', 'rejected'));
  await dashboard.started;
  const chart = chartOf(container);
  const svg = find(chart, (node) => node.tag === 'svg')[0];
  assert.equal(svg.attributes.role, 'img');
  assert.match(svg.attributes['aria-label'], /2 awaiting-review, 1 completed, 1 rejected\. 4 in total/);
  const segments = find(svg, (node) => /dash-seg /.test(cls(node)));
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((node) => cls(node)), ['dash-seg dash-seg-awaiting-review', 'dash-seg dash-seg-completed', 'dash-seg dash-seg-rejected']);
  const lengths = segments.map((node) => Number(node.attributes['stroke-dasharray'].split(' ')[0]));
  assert.ok(Math.abs(lengths[0] - 49.2) < 0.1 && Math.abs(lengths[1] - 24.2) < 0.1, lengths.join());
  const legend = find(chart, (node) => node.className === 'dash-legend')[0];
  assert.deepEqual(find(legend, (node) => node.tag === 'li').map((node) => node.textContent.replace(/\s+/g, ' ').trim()), ['awaiting-review 2', 'completed 1', 'rejected 1']);
  assert.match(find(svg, (node) => cls(node) === 'dash-donut-total')[0].textContent, /^4$/);
});

test('demo items and events without a case never reach the donut or the overview counts', async () => {
  const { container, dashboard } = mount(async () => {
    const data = withCases('awaiting-review');
    data.workflow.events.push({ eventId: 'e-no-case', occurredAt: '2026-10-27T10:05:00.000Z', itemId: null, observedQuantity: null });
    return data;
  });
  await dashboard.started;
  const chart = chartOf(container);
  assert.doesNotMatch(chart.textContent, /DEMO|evt-demo|Disputed/);
  assert.equal(find(chart, (node) => /dash-seg /.test(cls(node))).length, 1);
  assert.match(find(chart, (node) => cls(node) === 'dash-donut-total')[0].textContent, /^1$/);
  const values = find(container, (node) => node.className === 'dash-card-value').map((node) => node.textContent);
  assert.deepEqual(values, ['2', '0', '2', '1']);
});

test('with no cases the chart area shows an empty state and draws nothing', async () => {
  const { container, dashboard } = mount(async () => ({ workflow: { events: [{ eventId: 'e1', occurredAt: '2026-10-27T10:00:00.000Z', itemId: null, observedQuantity: null }], cases: [], actions: [] } }));
  await dashboard.started;
  const chart = chartOf(container);
  assert.equal(find(chart, (node) => node.tag === 'svg').length, 0);
  assert.match(chart.textContent, /No cases are recorded yet/);
});

test('each overview tile has a decorative icon and the label stays as text', async () => {
  const { container, dashboard } = mount(async () => sample);
  await dashboard.started;
  const tiles = find(container, (node) => /^dash-card dash-card-/.test(node.className));
  assert.equal(tiles.length, 4);
  for (const tile of tiles) {
    const icons = find(tile, (node) => node.tag === 'svg');
    assert.equal(icons.length, 1);
    assert.equal(icons[0].attributes['aria-hidden'], 'true');
    assert.ok(find(tile, (node) => node.className === 'dash-card-label')[0].textContent.length > 3);
  }
});

test('recent activity is a labelled table with six columns, and demo rows are tagged', async () => {
  const { container, dashboard } = mount(async () => sample);
  await dashboard.started;
  const table = find(container, (node) => node.tag === 'table')[0];
  assert.deepEqual(find(table, (node) => node.tag === 'th').map((node) => node.textContent), ['Time', 'Item', 'Event', 'Quantity', 'Agent', 'Status']);
  const rows = find(table, (node) => /^dash-row/.test(node.className));
  assert.ok(rows.length >= 5);
  for (const row of rows) {
    const cells = row.children;
    assert.equal(cells.length, 6);
    assert.deepEqual(cells.map((cell) => cell.attributes['data-label']), ['Time', 'Item', 'Event', 'Quantity', 'Agent', 'Status']);
    assert.equal(/DEMO/.test(row.textContent), row.className.includes('dash-row-demo'));
  }
});

const glanceOf = (container) => find(container, (node) => /^dash-glance( |$)/.test(node.className))[0];

test('the at-a-glance strip shows only the first real item needing attention, with no counts and no demo content', async () => {
  const { container, dashboard } = mount(async () => withCases('approved', 'needs-information', 'awaiting-review'));
  await dashboard.started;
  const strip = glanceOf(container);
  assert.equal(strip.attributes['aria-label'], 'First item needing attention');
  assert.match(strip.textContent, /First item needing attention/);
  // The adapter lists attention items in case order; the strip takes the first, and does not rank.
  assert.match(strip.textContent, /Approved count is waiting to be applied/);
  assert.match(strip.textContent, /event e0/);
  assert.doesNotMatch(strip.textContent, /event e2/);
  assert.doesNotMatch(strip.textContent, /DEMO|evt-demo|Disputed/);
  assert.equal(find(strip, (node) => node.className === 'dash-card-value').length, 0);
  assert.doesNotMatch(strip.textContent, /Events validated|Completed|In progress/);
  // It sits above the demo banner and the rest of the content.
  const order = container.children.map((node) => node.className);
  assert.ok(order.indexOf('dash-glance-slot') < order.indexOf('dash-banner'));
  assert.ok(order.indexOf('dash-banner') < order.indexOf('dash-content'));
});

test('with nothing to attend to, the strip says so honestly, and demo items never replace it', async () => {
  const { container, dashboard } = mount(async () => withCases('completed', 'no-action'));
  await dashboard.started;
  const wording = 'No case in the current records needs attention. Conflicts and rejected events are not recorded yet.';
  const strip = glanceOf(container);
  assert.ok(strip.className.includes('dash-glance-clear-state'));
  assert.ok(strip.textContent.includes(wording));
  assert.doesNotMatch(strip.textContent, /DEMO|evt-demo/);
  const toggle = find(container, (node) => node.tag === 'input')[0];
  toggle.checked = false;
  toggle.handlers.change();
  assert.ok(glanceOf(container).textContent.includes(wording));
});

test('tiles and the donut share one row, agents are numbered, and the strip is absent while loading', async () => {
  let release;
  const { container, dashboard } = mount(() => new Promise((resolve) => { release = resolve; }));
  assert.equal(glanceOf(container), undefined);
  release(sample);
  await dashboard.started;
  const overview = find(container, (node) => node.className === 'dash-overview')[0];
  assert.equal(find(overview, (node) => node.className === 'dash-cards').length, 1);
  assert.equal(find(overview, (node) => node.className === 'dash-chart').length, 1);
  assert.equal(find(overview, (node) => node.className === 'dash-card-value').length, 4);
  const steps = find(container, (node) => node.className === 'dash-step');
  assert.deepEqual(steps.map((node) => node.textContent), ['1', '2', '3', '4']);
  for (const step of steps) assert.equal(step.attributes['aria-hidden'], 'true');
});

test('the dashboard styles leave the shared page container and header width alone', async () => {
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* Agent progress dashboard */'));
  assert.doesNotMatch(block, /\.page-shell|100vw|translateX|1440/);
  assert.doesNotMatch(block, /\.topbar\s*\{[^}]*(max-width|padding|width)/);
});

test('the welcome band keeps its copy, adds only the simulated-events chip, and implies nothing live', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const intro = html.slice(html.indexOf('<section class="intro">'), html.indexOf('</section>', html.indexOf('<section class="intro">')));
  assert.match(intro, /<p class="eyebrow">INVENTORY WORKSPACE<\/p>/);
  assert.match(intro, /<h1>Know what’s available\.<\/h1>/);
  assert.match(intro, /<p class="intro-copy">Record a shelf restock, track the units in motion, and reconcile what happened\.<\/p>/);
  assert.match(intro, /<div class="status-pill"><span><\/span> Local workspace<\/div>/);
  assert.match(intro, /<div class="status-pill">Simulated events only<\/div>/);
  assert.equal(intro.match(/status-pill/g).length, 2);
  assert.doesNotMatch(intro, /live|real[- ]time|online|running|active/i);
  // Startup must keep the integrated dashboard inside the locked workspace.
  assert.match(html, /<main class="page-shell" hidden inert>\s*<fieldset id="workspace-controls" disabled[^>]*>\s*<section class="intro">/);
  assert.ok(html.includes('<a class="brand" href="/" aria-label="Lookout home"><span class="brand-mark">L</span> Lookout</a>'));
  assert.ok(html.includes('<span class="topbar-label">Inventory visibility</span>'));
});

test('the welcome band styles scale up on wide screens, stay compact on phones, and leave shared widths alone', async () => {
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const band = css.slice(css.indexOf('/* Welcome band'));
  assert.ok(band.length > 500);
  assert.match(band, /\.intro h1 \{ font-size: 52px/);
  assert.match(band, /\.intro \.intro-copy \{[^}]*font-size: 19px/);
  assert.match(band, /linear-gradient\(120deg, #0f1f33/);
  const phone = band.slice(band.indexOf('@media (max-width: 600px)'));
  assert.match(phone, /\.intro h1 \{ font-size: 28px/);
  assert.match(phone, /\.topbar \{ height: 56px/);
  assert.doesNotMatch(band, /\.page-shell|100vw|translateX|1440|animation|transition|@keyframes/);
  assert.doesNotMatch(band, /\.topbar\s*\{[^}]*(max-width|padding|width)/);
});

test('the dashboard styles add no animation, and keep focus outlines and tabular figures', async () => {
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* Agent progress dashboard */'));
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /@keyframes|animation|transition/);
  assert.match(block, /\.dashboard button:focus-visible/);
  assert.match(block, /font-variant-numeric: tabular-nums/);
});

test('the page renders data as text only and reads from the one existing endpoint', async () => {
  for (const file of ['dashboard.js', 'dashboard-adapter.js', 'dashboard-demo-data.js']) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/, file);
  }
  const source = await readFile(new URL('./dashboard.js', import.meta.url), 'utf8');
  assert.deepEqual(source.match(/\/api\/[a-z/]+/g), ['/api/agent/workflow']);
  assert.doesNotMatch(source, /method:\s*['"]POST/i);
});


test('refresh during an in-flight read reloads after that stale response', async () => {
  let release, calls = 0;
  const { container, dashboard } = mount(() => ++calls === 1
    ? new Promise(resolve => { release = resolve; })
    : Promise.resolve(withCases('approved')));
  await dashboard.refresh();
  release({ workflow: { events: [], cases: [], actions: [] } });
  await dashboard.started;
  assert.equal(calls, 2);
  assert.match(glanceOf(container).textContent, /Approved count is waiting to be applied/);
});
