import { adaptWorkflowResponse, AGENT_NAME_NOTE, STATE_COVERAGE } from './dashboard-adapter.js';
import { DEMO_ACTIVITY, DEMO_ATTENTION, DEMO_BANNER } from './dashboard-demo-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// A symbol accompanies every status label so meaning never depends on colour alone.
const SYMBOLS = { ok: '✓', info: '●', attention: '!', nodata: '–', demo: '◇' };

// Simple stroke icons, one per overview tile. They are static decoration (aria-hidden).
const ICONS = {
  validated: ['M7 3h7l4 4v14H7z', 'M14 3v4h4', 'm9.5 14 2 2 3.5-4'],
  completed: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'm8 12.5 2.8 2.8L16 9.5'],
  'in-progress': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'],
  attention: ['M12 3 2.5 20h19z', 'M12 10v4', 'M12 17.2v.1'],
};

const DONUT_RADIUS = 15.9155; // circumference of 100, so a segment length is its percentage

const NOTHING_TO_ATTEND = 'No case in the current records needs attention. Conflicts and rejected events are not recorded yet.';

function make(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgNode(doc, tag, attributes = {}, text) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(doc, name) {
  const svg = svgNode(doc, 'svg', { viewBox: '0 0 24 24', class: 'dash-icon', 'aria-hidden': 'true', focusable: 'false', fill: 'none',
    stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  for (const d of ICONS[name] ?? []) svg.append(svgNode(doc, 'path', { d }));
  return svg;
}

function chip(doc, tone, label) {
  const node = make(doc, 'span', `dash-chip dash-chip-${tone}`);
  const symbol = make(doc, 'span', 'dash-chip-symbol', SYMBOLS[tone] ?? SYMBOLS.info);
  symbol.setAttribute('aria-hidden', 'true');
  node.append(symbol, make(doc, 'span', undefined, label));
  return node;
}

function defaultFormatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

async function fetchWorkflowFromApi() {
  const response = await fetch('/api/agent/workflow', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.json();
}

function renderOverview(doc, overview) {
  const list = make(doc, 'ul', 'dash-cards');
  for (const card of overview) {
    const item = make(doc, 'li', `dash-card dash-card-${card.id}`);
    const top = make(doc, 'div', 'dash-card-top');
    const symbol = make(doc, 'span', 'dash-card-icon');
    symbol.append(icon(doc, card.id === 'attention' ? 'attention' : card.id));
    top.append(symbol, make(doc, 'p', 'dash-card-label', card.label));
    item.append(top, make(doc, 'p', 'dash-card-value', String(card.value)), make(doc, 'p', 'dash-card-detail', card.detail));
    list.append(item);
  }
  return list;
}

function renderAgents(doc, agents) {
  const list = make(doc, 'ul', 'dash-agents');
  agents.forEach((agent, index) => {
    const item = make(doc, 'li', 'dash-agent');
    // The number is the stage order in the code, not a progress indicator.
    const head = make(doc, 'div', 'dash-agent-head');
    const step = make(doc, 'span', 'dash-step', String(index + 1));
    step.setAttribute('aria-hidden', 'true');
    head.append(step, make(doc, 'h4', 'dash-agent-name', agent.name));
    const status = make(doc, 'div', 'dash-agent-status');
    status.append(chip(doc, agent.status.tone, agent.status.label), make(doc, 'p', 'dash-detail', agent.status.detail));
    item.append(head, make(doc, 'p', 'dash-agent-design', `Design name: ${agent.designName}`),
      make(doc, 'p', 'dash-agent-role', agent.responsibility), status);
    list.append(item);
  });
  return list;
}

// The first real item needing attention, in the order the adapter returns them. Nothing is ranked,
// and demo examples are never passed in.
function renderGlance(doc, first) {
  const strip = make(doc, 'section', first ? 'dash-glance' : 'dash-glance dash-glance-clear-state');
  strip.setAttribute('role', 'region');
  strip.setAttribute('aria-label', 'First item needing attention');
  const label = make(doc, 'p', 'dash-glance-label');
  if (first) label.append(icon(doc, 'attention'));
  label.append(make(doc, 'span', undefined, 'First item needing attention'));
  strip.append(label);
  if (!first) {
    strip.append(make(doc, 'p', 'dash-glance-text', NOTHING_TO_ATTEND));
    return strip;
  }
  const head = make(doc, 'div', 'dash-glance-head');
  head.append(make(doc, 'strong', 'dash-glance-issue', first.issue), chip(doc, first.tone, first.status));
  strip.append(head);
  if (first.detail) strip.append(make(doc, 'p', 'dash-detail', first.detail));
  strip.append(make(doc, 'p', 'dash-detail', `Related: ${first.reference} · event ${first.eventId}`),
    make(doc, 'p', 'dash-detail', `Next action: ${first.nextAction ?? 'not known'}`));
  return strip;
}

// Donut of recorded cases by status. Segments come from statusCounts only, so demo items and
// events without a case can never appear. The legend repeats every number as text.
function renderStatusChart(doc, statusCounts) {
  const wrapper = make(doc, 'div', 'dash-chart');
  const total = statusCounts.reduce((sum, entry) => sum + entry.count, 0);
  if (!total) {
    wrapper.append(make(doc, 'p', 'empty-state', 'No cases are recorded yet, so there is nothing to chart.'));
    return wrapper;
  }
  const svg = svgNode(doc, 'svg', { viewBox: '0 0 42 42', class: 'dash-donut', role: 'img',
    'aria-label': `Recorded cases by status: ${statusCounts.map((entry) => `${entry.count} ${entry.status}`).join(', ')}. ${total} in total.` });
  svg.append(svgNode(doc, 'circle', { cx: 21, cy: 21, r: DONUT_RADIUS, fill: 'none', class: 'dash-donut-track' }));
  let start = 0;
  for (const entry of statusCounts) {
    const length = (entry.count / total) * 100;
    const gap = statusCounts.length > 1 ? Math.min(0.8, length / 2) : 0;
    svg.append(svgNode(doc, 'circle', { cx: 21, cy: 21, r: DONUT_RADIUS, fill: 'none', class: `dash-seg dash-seg-${entry.status}`,
      'stroke-dasharray': `${(length - gap).toFixed(3)} ${(100 - length + gap).toFixed(3)}`, 'stroke-dashoffset': (25 - start).toFixed(3) }));
    start += length;
  }
  svg.append(svgNode(doc, 'text', { x: 21, y: 22, class: 'dash-donut-total' }, String(total)),
    svgNode(doc, 'text', { x: 21, y: 27.2, class: 'dash-donut-caption' }, total === 1 ? 'case' : 'cases'));

  const legend = make(doc, 'ul', 'dash-legend');
  for (const entry of statusCounts) {
    const item = make(doc, 'li');
    const swatch = make(doc, 'span', `dash-swatch dash-swatch-${entry.status}`);
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, make(doc, 'span', 'dash-legend-name', entry.status), make(doc, 'span', 'dash-legend-count', String(entry.count)));
    legend.append(item);
  }
  wrapper.append(svg, legend);
  return wrapper;
}

function renderAttention(doc, items) {
  const list = make(doc, 'ul', 'dash-list dash-list-attention');
  for (const entry of items) {
    const item = make(doc, 'li', entry.demo ? 'dash-item dash-item-demo' : 'dash-item');
    const head = make(doc, 'div', 'dash-item-head');
    head.append(make(doc, 'strong', undefined, entry.issue));
    if (entry.demo) head.append(chip(doc, 'demo', 'DEMO'));
    head.append(chip(doc, entry.tone, entry.status));
    item.append(head);
    if (entry.detail) item.append(make(doc, 'p', 'dash-detail', entry.detail));
    item.append(make(doc, 'p', 'dash-detail', `Related: ${entry.reference} · event ${entry.eventId}`),
      make(doc, 'p', 'dash-detail', `Next action: ${entry.nextAction ?? 'not known'}`));
    list.append(item);
  }
  return list;
}

function cell(doc, label, ...nodes) {
  const td = make(doc, 'td');
  td.setAttribute('role', 'cell');
  td.setAttribute('data-label', label);
  td.append(...nodes);
  return td;
}

function renderFeed(doc, items, formatTime) {
  const table = make(doc, 'table', 'dash-table');
  table.setAttribute('role', 'table');
  const caption = make(doc, 'caption', 'sr-only', 'Recent activity, newest first. Demo rows are tagged DEMO.');
  const head = make(doc, 'thead');
  head.setAttribute('role', 'rowgroup');
  const headRow = make(doc, 'tr');
  headRow.setAttribute('role', 'row');
  for (const name of ['Time', 'Item', 'Event', 'Quantity', 'Agent', 'Status']) {
    const th = make(doc, 'th', undefined, name);
    th.setAttribute('scope', 'col');
    th.setAttribute('role', 'columnheader');
    headRow.append(th);
  }
  head.append(headRow);
  const body = make(doc, 'tbody');
  body.setAttribute('role', 'rowgroup');
  for (const entry of items) {
    const row = make(doc, 'tr', entry.demo ? 'dash-row dash-row-demo' : 'dash-row');
    row.setAttribute('role', 'row');
    const event = [make(doc, 'span', 'dash-event', entry.eventType)];
    if (entry.demo) event.push(chip(doc, 'demo', 'DEMO'));
    row.append(
      cell(doc, 'Time', make(doc, 'span', undefined, entry.time ? formatTime(entry.time) : 'Time not recorded')),
      cell(doc, 'Item', make(doc, 'span', undefined, entry.reference)),
      cell(doc, 'Event', ...event),
      cell(doc, 'Quantity', make(doc, 'span', undefined, entry.quantity === null ? 'Not available' : String(entry.quantity))),
      cell(doc, 'Agent', make(doc, 'span', undefined, entry.agent)),
      cell(doc, 'Status', chip(doc, entry.tone, entry.status)),
    );
    body.append(row);
  }
  table.append(caption, head, body);
  return table;
}

function panel(doc, title, ...nodes) {
  const section = make(doc, 'section', 'dash-panel');
  section.append(make(doc, 'h3', 'dash-heading', title), ...nodes);
  return section;
}

function renderContent(doc, model, showDemo, formatTime) {
  const parts = [];
  const chart = panel(doc, 'Cases by status', renderStatusChart(doc, model.statusCounts),
    make(doc, 'p', 'dash-note', 'Recorded cases only. Demo examples and events that have no case yet are not included.'));
  const overview = make(doc, 'div', 'dash-overview');
  overview.append(renderOverview(doc, model.overview), chart);
  parts.push(overview);

  parts.push(make(doc, 'h3', 'dash-heading', 'Agents'));
  parts.push(make(doc, 'p', 'dash-note', AGENT_NAME_NOTE));
  parts.push(renderAgents(doc, model.agents));

  const attention = [...model.attention, ...(showDemo ? DEMO_ATTENTION : [])];
  const needs = panel(doc, 'Needs attention');
  if (!model.attention.length) needs.append(make(doc, 'p', 'empty-state', NOTHING_TO_ATTEND));
  if (attention.length) needs.append(renderAttention(doc, attention));
  parts.push(needs);

  const feed = [...model.activity, ...(showDemo ? DEMO_ACTIVITY : [])];
  const recent = panel(doc, 'Recent activity');
  if (!model.inventoryAvailable) {
    recent.append(make(doc, 'p', 'dash-note', 'Inventory activity (items added, restocks) is not included by this data source in local demo mode.'));
  }
  if (!model.activity.length) recent.append(make(doc, 'p', 'empty-state', 'No agent or inventory activity is recorded yet.'));
  if (feed.length) recent.append(renderFeed(doc, feed, formatTime));
  parts.push(recent);

  parts.push(make(doc, 'p', 'dash-note',
    `Tracked by the system: ${STATE_COVERAGE.tracked.join(', ')}. Not tracked: ${STATE_COVERAGE.notTracked.join(', ')}.`));
  return parts;
}

export function mountAgentDashboard({ container, document: doc = globalThis.document, fetchWorkflow = fetchWorkflowFromApi, formatTime = defaultFormatTime }) {
  const state = { model: null, loading: false, showDemo: true };

  const refreshButton = make(doc, 'button', 'button button-secondary', 'Refresh');
  refreshButton.type = 'button';
  const demoToggle = make(doc, 'input');
  demoToggle.type = 'checkbox';
  demoToggle.checked = true;
  const demoLabel = make(doc, 'label', 'dash-toggle');
  demoLabel.append(demoToggle, make(doc, 'span', undefined, 'Show demo examples'));
  const status = make(doc, 'p', 'muted');
  status.setAttribute('role', 'status');
  const controls = make(doc, 'div', 'dash-controls');
  controls.append(refreshButton, demoLabel, status);

  // Real data only: this slot never receives demo items.
  const glance = make(doc, 'div', 'dash-glance-slot');
  const banner = make(doc, 'p', 'dash-banner');
  const alert = make(doc, 'p', 'dash-error');
  alert.setAttribute('role', 'alert');
  alert.hidden = true;
  const content = make(doc, 'div', 'dash-content');
  container.replaceChildren(controls, glance, banner, alert, content);

  function render() {
    banner.textContent = state.showDemo ? DEMO_BANNER : 'Demo examples are hidden. Everything shown comes from recorded agent and inventory data.';
    if (!state.model) {
      glance.replaceChildren();
      content.replaceChildren(make(doc, 'p', 'empty-state', state.loading ? 'Loading agent activity…' : 'No agent activity to show.'));
      return;
    }
    glance.replaceChildren(renderGlance(doc, state.model.attention[0]));
    content.replaceChildren(...renderContent(doc, state.model, state.showDemo, formatTime));
  }

  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    refreshButton.disabled = true;
    alert.hidden = true;
    status.textContent = 'Loading agent activity…';
    render();
    try {
      state.model = adaptWorkflowResponse(await fetchWorkflow());
      status.textContent = `Last updated ${formatTime(new Date().toISOString())}`;
    } catch {
      alert.hidden = false;
      alert.textContent = state.model
        ? 'Agent activity could not be refreshed. Showing the last loaded data.'
        : 'Agent activity could not be loaded. Try Refresh. Nothing in your inventory was changed.';
      status.textContent = '';
    } finally {
      state.loading = false;
      refreshButton.disabled = false;
      render();
    }
  }

  refreshButton.addEventListener('click', () => { void refresh(); });
  demoToggle.addEventListener('change', () => { state.showDemo = demoToggle.checked; render(); });
  render();
  return { refresh, started: refresh() };
}
