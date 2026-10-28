// Illustrative examples only. The backend does not record conflicting, incomplete or
// repeatedly conflicting events, or unknown outcomes, so none of this is real agent activity.
// Delete this module (and its import in dashboard.js) once the backend records these cases.
// Items are written in the dashboard's view-model shape, not in backend field names.

export const DEMO_BANNER = 'Demo data: conflicting events, missing-information events and unknown outcomes are not recorded by the current backend. Items tagged DEMO are illustrative examples, not real agent activity. The overview counts use real records only.';

export const DEMO_ATTENTION = Object.freeze([
  { id: 'demo:conflict', demo: true, tone: 'attention', status: 'Disputed',
    issue: 'Same event ID reported with different quantities',
    detail: 'evt-demo-1042 first reported 12 units, then 9 units.',
    reference: 'Demo item: Blue notebooks', eventId: 'evt-demo-1042',
    nextAction: 'A person reviews both reports. The first report stays on record; the second was not applied.' },
  { id: 'demo:repeat', demo: true, tone: 'attention', status: 'Needs human review',
    issue: 'Repeated conflicts for the same event',
    detail: 'evt-demo-1042 has conflicted 3 times.',
    reference: 'Demo item: Blue notebooks', eventId: 'evt-demo-1042',
    nextAction: 'Escalate to an inventory reviewer.' },
  { id: 'demo:missing', demo: true, tone: 'attention', status: 'Rejected at intake',
    issue: 'Required event information is missing',
    detail: 'evt-demo-1043 arrived without count evidence.',
    reference: 'Demo item: Packing tape', eventId: 'evt-demo-1043',
    nextAction: 'The source must resend a complete event.' },
  { id: 'demo:unknown', demo: true, tone: 'attention', status: 'Outcome unknown',
    issue: 'No processing outcome is recorded',
    detail: 'evt-demo-1044 has no recorded result.',
    reference: 'Demo item: Shipping labels', eventId: 'evt-demo-1044',
    nextAction: null },
]);

export const DEMO_ACTIVITY = Object.freeze([
  { id: 'demo:feed-conflict', demo: true, tone: 'attention', time: null, reference: 'Demo item: Blue notebooks',
    eventType: 'Conflicting event flagged', quantity: 9, agent: 'Detection', status: 'Disputed' },
  { id: 'demo:feed-review', demo: true, tone: 'attention', time: null, reference: 'Demo item: Blue notebooks',
    eventType: 'Task sent for human review', quantity: null, agent: 'Review Coordination', status: 'Awaiting review' },
  { id: 'demo:feed-missing', demo: true, tone: 'attention', time: null, reference: 'Demo item: Packing tape',
    eventType: 'Incomplete event rejected', quantity: null, agent: 'Detection', status: 'Rejected at intake' },
]);
