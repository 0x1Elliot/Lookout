// Every backend field name the dashboard reads is confined to this file, so a change to
// the Detection -> Inventory contract only needs to be made here. The rest of the page
// works with the plain view model that adaptWorkflowResponse() returns.

// Each assumption below was read from the code on main (6802a22), not from a design document.
export const FIELD_ASSUMPTIONS = Object.freeze([
  'Source: GET /api/agent/workflow. Secure mode returns { inventory, revision, workflow, identity }; the local demo server returns { workflow } only, so inventory activity is unavailable there.',
  'workflow.events[]: eventId, occurredAt, itemId (nullable), observedQuantity (nullable). One event is processed at a time; the code has no run_id, event_ids or batch.',
  'An event is stored only after validation succeeds, so "received" cannot be told apart from "validated". The page shows "validated".',
  'workflow.cases[]: caseId, eventId, status, discrepancyType, unknowns[], proposedAction{expectedQuantity, targetQuantity}, review{outcome, decidedAt}, reviewHistory[]. Status values read: awaiting-review, needs-information, approved, completed, no-action, rejected. Any other value is shown as unrecognized.',
  'Cases have no creation timestamp. Reconciliation entries show "Time not recorded" and are ordered by their event time.',
  'workflow.actions[]: actionRequestId, itemId, quantityOnHand, completedAt.',
  'inventory.inventoryItems[]: id, name. The data has no SKU field, so an item is shown by name, or by id when the name is unavailable.',
  'inventory.activity[]: id, type, itemName, quantity, createdAt, actionRequestId. These entries do not record which agent acted, so their agent is shown as "Not recorded".',
  'Disputed and resolved states are not stored. An event whose id repeats with different data is rejected with an error and nothing is recorded, so conflicts exist only as demo examples.',
]);

export const AGENT_NAME_NOTE = 'These are the four stages that exist in the code. They map to the design’s Detection, Inventory and Reconciliation & Response agents; that mapping has not been confirmed by Elliot.';

export const STATE_COVERAGE = Object.freeze({
  tracked: ['validated', 'awaiting review', 'needs information', 'approved', 'applied', 'rejected', 'no action needed'],
  notTracked: ['received (apart from validated)', 'disputed', 'resolved'],
});

const AGENTS = Object.freeze([
  { id: 'detection', name: 'Detection', designName: 'Detection', responsibility: 'Receives and checks incoming inventory events.' },
  { id: 'reconciliation', name: 'Reconciliation', designName: 'Reconciliation & Response', responsibility: 'Compares each validated event with recorded inventory and opens a case.' },
  { id: 'review', name: 'Review Coordination', designName: 'Reconciliation & Response', responsibility: 'Records a human reviewer’s decision on a case.' },
  { id: 'action', name: 'Inventory Action', designName: 'Inventory', responsibility: 'Applies an approved count to inventory and records the result.' },
]);

const CASE_STATES = {
  'awaiting-review': { label: 'Awaiting review', phase: 'in-progress', attention: true },
  'needs-information': { label: 'Needs information', phase: 'in-progress', attention: true },
  approved: { label: 'Approved, not yet applied', phase: 'in-progress', attention: true },
  completed: { label: 'Applied', phase: 'done', outcome: 'applied' },
  'no-action': { label: 'No action needed', phase: 'done', outcome: 'no action needed' },
  rejected: { label: 'Rejected by reviewer', phase: 'done', outcome: 'rejected' },
};
const UNRECOGNIZED = { label: 'Unrecognized status', phase: 'in-progress', attention: true };

const ACTIVITY_LABELS = {
  'inventory-item-added': 'New inventory recorded',
  'inventory-item-restocked': 'Stock received',
  'restock-started': 'Shelf restock initiated',
  'shelf-restocked': 'Shelf restocked',
  returned: 'Restock returned to inventory',
  'inventory-count-adjusted': 'Inventory count adjusted',
};
const REVIEW_LABELS = {
  approve: 'Review approved',
  reject: 'Review rejected',
  'request-more-information': 'More information requested',
};

const FEED_LIMIT = 30;

const text = (value, fallback = '') => (typeof value === 'string' && value.trim() ? value.slice(0, 200) : fallback);
const instant = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);
const quantity = (value) => (Number.isSafeInteger(value) ? value : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const join = (parts) => parts.filter(Boolean).join(' · ');

function attentionItem(record, label, eventById, itemRef) {
  const event = eventById.get(record.eventId);
  const unknown = text(record.unknowns?.[0]);
  const base = { id: `case:${text(record.caseId, 'unknown')}`, reference: itemRef(event?.itemId), eventId: text(record.eventId, 'unknown'), status: label, tone: 'attention', demo: false };
  if (!CASE_STATES[record.status]) {
    return { ...base, issue: 'Processing outcome not recognized', detail: `The case has the status "${text(record.status, 'missing')}".`, nextAction: null };
  }
  if (record.status === 'approved') {
    return { ...base, issue: 'Approved count is waiting to be applied', detail: 'Human review is complete. Inventory has not changed.',
      nextAction: 'An authorized worker applies the approved count through Inventory Action.' };
  }
  if (record.discrepancyType === 'unmatched-inventory-item') {
    return { ...base, issue: 'Event refers to an item that is not in inventory', detail: unknown,
      nextAction: 'A reviewer rejects the case or requests more information; approval is not available without a supported count.' };
  }
  if (record.status === 'needs-information') {
    const asked = record.review?.outcome === 'request-more-information';
    return { ...base, issue: asked ? 'More information requested by a reviewer' : 'Required event information is missing', detail: unknown,
      nextAction: asked ? 'Waiting for new information; no follow-up is recorded yet.' : 'A reviewer rejects the case or requests more information.' };
  }
  const proposed = record.proposedAction;
  const counts = quantity(proposed?.expectedQuantity) !== null && quantity(proposed?.targetQuantity) !== null
    ? `Recorded ${proposed.expectedQuantity}, observed ${proposed.targetQuantity}.` : '';
  return { ...base, issue: 'Observed count differs from recorded inventory', detail: join([counts, unknown]),
    nextAction: 'A reviewer approves or rejects the proposed count, or requests more information. Inventory has not changed.' };
}

function agentStatuses({ events, cases, actions, classified, awaitingReconciliation }) {
  const noData = (detail) => ({ label: 'No data', detail, tone: 'nodata' });
  const count = (status) => cases.filter((record) => record.status === status).length;
  const pendingDecision = count('awaiting-review') + count('needs-information');
  const decided = cases.filter((record) => record.review).length;
  const approved = count('approved');
  const closed = classified.filter((entry) => entry.phase === 'done').length;
  const statuses = {};

  statuses.detection = events.length
    ? { label: `${plural(events.length, 'event')} validated`, tone: 'info',
      detail: awaitingReconciliation ? `${awaitingReconciliation} not yet reconciled` : 'Every validated event has a case' }
    : noData('No events recorded yet');

  statuses.reconciliation = cases.length
    ? { label: `${plural(cases.length, 'case')} recorded`, tone: 'info',
      detail: join([
        pendingDecision && `${pendingDecision} awaiting a decision`,
        approved && `${approved} approved`,
        closed && `${closed} closed`,
      ]) }
    : noData('No cases recorded yet');

  statuses.review = pendingDecision
    ? { label: `${pendingDecision} awaiting a decision`, tone: 'attention', detail: `${plural(decided, 'decision')} recorded so far` }
    : decided ? { label: `${plural(decided, 'decision')} recorded`, tone: 'ok', detail: 'No case is waiting for a decision' }
      : noData('No reviewer decisions recorded yet');

  statuses.action = approved
    ? { label: `${approved} approved, not yet applied`, tone: 'attention', detail: `${plural(actions.length, 'count')} applied so far` }
    : actions.length ? { label: `${plural(actions.length, 'count')} applied`, tone: 'ok', detail: 'No approved case is waiting' }
      : noData('No actions recorded yet');

  return AGENTS.map((agent) => ({ ...agent, status: statuses[agent.id] }));
}

export function adaptWorkflowResponse(response) {
  const workflow = response?.workflow;
  if (!workflow || !Array.isArray(workflow.events) || !Array.isArray(workflow.cases) || !Array.isArray(workflow.actions)) {
    throw new Error('Unexpected workflow response.');
  }
  const { events, cases, actions } = workflow;
  const inventory = response.inventory;
  const inventoryAvailable = Array.isArray(inventory?.inventoryItems) && Array.isArray(inventory?.activity);
  const itemNames = new Map(inventoryAvailable ? inventory.inventoryItems.map((item) => [item.id, item.name]) : []);
  const itemRef = (id) => (id === null || id === undefined ? 'No item identified' : text(itemNames.get(id), text(id, 'Unknown item')));
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const caseEventIds = new Set(cases.map((record) => record.eventId));

  const classified = cases.map((record) => ({ record, ...(CASE_STATES[record.status] ?? UNRECOGNIZED) }));
  const awaitingReconciliation = events.filter((event) => !caseEventIds.has(event.eventId)).length;
  const done = classified.filter((entry) => entry.phase === 'done');
  const inProgress = classified.filter((entry) => entry.phase === 'in-progress');
  const attention = classified.filter((entry) => entry.attention).map((entry) => attentionItem(entry.record, entry.label, eventById, itemRef));

  // Recorded cases only, grouped by the code's own status names. Events that have no case yet
  // and demo examples are never counted here.
  const statusOf = (entry) => (Object.hasOwn(CASE_STATES, entry.record.status) ? entry.record.status : 'unrecognized');
  const statusCounts = [...Object.keys(CASE_STATES), 'unrecognized']
    .map((status) => ({ status, count: classified.filter((entry) => statusOf(entry) === status).length }))
    .filter((entry) => entry.count > 0);

  const outcomeCount = (outcome) => done.filter((entry) => entry.outcome === outcome).length;
  const withReviewer = classified.filter((entry) => ['awaiting-review', 'needs-information'].includes(entry.record.status)).length;
  const approved = classified.filter((entry) => entry.record.status === 'approved').length;
  const overview = [
    { id: 'validated', label: 'Events validated', value: events.length,
      detail: 'Only validated events are stored, so "received" is not counted separately.' },
    { id: 'completed', label: 'Completed', value: done.length,
      detail: join(['applied', 'no action needed', 'rejected'].map((outcome) => outcomeCount(outcome) && `${outcomeCount(outcome)} ${outcome}`)) || 'None yet' },
    { id: 'in-progress', label: 'In progress', value: awaitingReconciliation + inProgress.length,
      detail: join([awaitingReconciliation && `${awaitingReconciliation} awaiting reconciliation`, withReviewer && `${withReviewer} with a reviewer`, approved && `${approved} approved, not applied`]) || 'None right now' },
    { id: 'attention', label: 'Needs attention', value: attention.length, detail: 'Counted from recorded cases only. Demo examples are not included.' },
  ];

  const activity = [];
  for (const event of events) {
    activity.push({ id: `event:${text(event.eventId, 'unknown')}`, rank: 0, time: instant(event.occurredAt), sortTime: instant(event.occurredAt),
      reference: itemRef(event.itemId), eventType: 'Count observed', quantity: quantity(event.observedQuantity), agent: 'Detection', status: 'Validated', tone: 'info', demo: false });
  }
  for (const entry of classified) {
    const event = eventById.get(entry.record.eventId);
    const kind = entry.record.discrepancyType ? 'Discrepancy detected' : entry.record.status === 'needs-information' ? 'Case opened, information missing' : 'Reconciled, no discrepancy';
    activity.push({ id: `case:${text(entry.record.caseId, 'unknown')}`, rank: 1, time: null, sortTime: instant(event?.occurredAt),
      reference: itemRef(event?.itemId), eventType: kind, quantity: quantity(event?.observedQuantity), agent: 'Reconciliation', status: entry.label, tone: entry.attention ? 'attention' : 'info', demo: false });
    const decisions = Array.isArray(entry.record.reviewHistory) && entry.record.reviewHistory.length ? entry.record.reviewHistory : entry.record.review ? [entry.record.review] : [];
    decisions.forEach((decision, index) => {
      activity.push({ id: `review:${text(entry.record.caseId, 'unknown')}:${index}`, rank: 2, time: instant(decision.decidedAt), sortTime: instant(decision.decidedAt),
        reference: itemRef(event?.itemId), eventType: REVIEW_LABELS[decision.outcome] ?? 'Review recorded', quantity: null, agent: 'Review Coordination', status: 'Recorded', tone: 'info', demo: false });
    });
  }
  for (const action of actions) {
    activity.push({ id: `action:${text(action.actionRequestId, 'unknown')}`, rank: 3, time: instant(action.completedAt), sortTime: instant(action.completedAt),
      reference: itemRef(action.itemId), eventType: 'Count applied to inventory', quantity: quantity(action.quantityOnHand), agent: 'Inventory Action', status: 'Applied', tone: 'ok', demo: false });
  }
  if (inventoryAvailable) {
    const appliedRequests = new Set(actions.map((action) => action.actionRequestId));
    for (const entry of inventory.activity) {
      // A count adjustment is already shown by its workflow action above.
      if (entry.type === 'inventory-count-adjusted' && appliedRequests.has(entry.actionRequestId)) continue;
      activity.push({ id: `activity:${text(entry.id, text(entry.createdAt, 'unknown'))}:${text(entry.type)}`, rank: 0, time: instant(entry.createdAt), sortTime: instant(entry.createdAt),
        reference: text(entry.itemName, 'Unknown item'), eventType: ACTIVITY_LABELS[entry.type] ?? 'Other inventory activity', quantity: quantity(entry.quantity),
        agent: 'Not recorded', status: 'Recorded', tone: 'info', demo: false });
    }
  }
  // Newest first; an entry with no usable time goes last. Later workflow stages sort ahead of earlier ones.
  activity.sort((a, b) => (Date.parse(b.sortTime) || 0) - (Date.parse(a.sortTime) || 0) || b.rank - a.rank);

  return {
    inventoryAvailable,
    overview,
    statusCounts,
    agents: agentStatuses({ events, cases, actions, classified, awaitingReconciliation }),
    attention,
    activity: activity.slice(0, FEED_LIMIT),
  };
}
