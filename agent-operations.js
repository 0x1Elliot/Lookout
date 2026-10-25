export function mountAgentOperations({ getInventory, updateInventory, addSample, disabled = false }) {
  const $ = id => document.getElementById(id);
  let record, event, actionResult, actionSnapshot, applied = false, busy = false;
  const stages = ['Detection', 'Reconciliation', 'Review Coordination', 'Inventory Action'];
  function refresh() {
    const selected = $('agent-item').value;
    $('agent-item').replaceChildren(new Option('Select inventory item', ''));
    for (const item of getInventory().inventoryItems) {
      $('agent-item').add(new Option(`${item.name} · ${item.quantityOnHand} on hand`, item.id));
    }
    $('agent-item').value = selected;
    const progress = [event ? 'Validated' : 'Waiting', record ? record.discrepancyType ?? record.status : 'Waiting', record?.review?.outcome ?? 'Waiting', applied ? 'Completed' : record?.status === 'rejected' ? 'Blocked by rejection' : 'Waiting'];
    $('agent-stages').replaceChildren(...stages.map((name, i) => {
      const card = document.createElement('div'); card.className = 'agent-stage';
      const title = document.createElement('strong'); title.textContent = `${i + 1}. ${name}`;
      const status = document.createElement('p'); status.textContent = progress[i]; card.append(title, status); return card;
    }));
    $('agent-review-form').hidden = !record?.reviewRequired || Boolean(record?.review);
    $('agent-apply').hidden = record?.status !== 'approved' || applied;
    document.querySelectorAll('.agent-panel button, .agent-panel input, .agent-panel select').forEach(control => control.disabled = busy || disabled);
  }
  async function post(input) {
    const response = await fetch('/api/agent/workflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
    return result;
  }
  async function run(operation) {
    if (busy || disabled) return;
    busy = true; refresh();
    try { await operation(); } catch (error) { $('agent-status').textContent = `${error.message} Start a new test event if inventory changed or the server restarted.`; }
    finally { busy = false; refresh(); }
  }
  function details(result) {
    $('agent-audit').textContent = JSON.stringify({ event, caseRecord: record, action: result?.action, activity: result?.inventory?.activity[0] }, null, 2);
  }
  $('agent-sample').addEventListener('click', () => run(async () => {
    const item = addSample(); refresh(); $('agent-item').value = item.id;
    $('agent-count').value = '5'; $('agent-status').textContent = 'Sample added: recorded 8 units. Run the synthetic count of 5.';
  }));
  $('agent-event-form').addEventListener('submit', e => {
    e.preventDefault();
    const itemId = $('agent-item').value;
    const observedQuantity = Number($('agent-count').value);
    run(async () => {
      record = undefined; event = undefined; actionResult = undefined; actionSnapshot = undefined; applied = false; $('agent-evidence').replaceChildren(); details();
      const id = crypto.randomUUID(), timestamp = new Date().toISOString();
      const input = { eventId: `ui-${id}`, occurredAt: timestamp, source: 'synthetic/browser-test', type: 'inventory-count-observed', itemId, observedQuantity,
        evidence: [{ id: `sheet-${id}`, kind: 'manual-count-sheet', description: `Synthetic test count sheet reports ${observedQuantity} units. This is not a real physical observation.`, observedAt: timestamp, observedQuantity }] };
      const intake = await post({ stage: 'intake', event: input }); event = intake.event; refresh();
      const result = await post({ stage: 'reconcile', eventId: event.eventId, inventory: getInventory() }); record = result.caseRecord;
      for (const text of [...record.observedFacts.map(f => f.statement), ...record.inferences.map(f => f.statement), ...record.unknowns, ...event.evidence.map(e => `Evidence ${e.id}: ${e.description}`)]) {
        const p = document.createElement('p'); p.textContent = text; $('agent-evidence').append(p);
      }
      $('agent-status').textContent = record.proposedAction ? 'Discrepancy ready for human review. Inventory has not changed.' : `Case: ${record.status}. No supported count change.`;
      details();
    });
  });
  $('agent-review-form').addEventListener('submit', e => {
    e.preventDefault(); const outcome = e.submitter.value;
    const reviewerName = $('agent-reviewer').value.trim(), rationale = $('agent-reason').value.trim();
    run(async () => {
      const result = await post({ stage: 'review', caseId: record.caseId, decision: { decisionId: crypto.randomUUID(), reviewerId: `local:${reviewerName}`, reviewerName, rationale, outcome } });
      record = result.caseRecord; details();
      $('agent-status').textContent = outcome === 'approve' ? 'Approved. Apply the count when ready; inventory is still unchanged.' : 'Rejected. Inventory unchanged; the decision is recorded in the audit details.';
    });
  });
  $('agent-apply').addEventListener('click', () => run(async () => {
    // Retain the successful response if browser storage fails, so retry only retries persistence.
    actionSnapshot ??= JSON.stringify(getInventory());
    actionResult ??= await post({ stage: 'action', caseId: record.caseId, request: { actionRequestId: `ui-action:${record.caseId}` }, inventory: getInventory() });
    if (JSON.stringify(getInventory()) !== actionSnapshot) throw new Error('Browser inventory changed while applying. The server result was not saved.');
    updateInventory(actionResult.inventory); applied = true; record = actionResult.workflow.cases.find(c => c.caseId === record.caseId);
    details(actionResult); $('agent-status').textContent = 'Completed. Inventory and Activity history now show the approved count and audit entry.';
  }));
  refresh(); return { refresh };
}
