// Real Claude tool-use spike, isolated from production inventory.
// Run: ANTHROPIC_API_KEY=... CLAUDE_MODEL=... node scripts/demo-autonomous-agents.mjs
// No database writes or external inventory connections.
const key = process.env.ANTHROPIC_API_KEY;
const model = process.env.CLAUDE_MODEL;
if (!key || !model) {
  console.error("Set ANTHROPIC_API_KEY and CLAUDE_MODEL (a model available to your account).");
  process.exit(1);
}
const stock = Object.freeze({ sku: "OAT-01", location: "Store A / Backroom", recorded: 24, shelfObserved: 3, evidence: "Manual shelf observation; backroom not yet counted." });
const ledger = [];
const tools = [
  { name: "get_inventory_evidence", description: "Read the recorded stock, shelf observation, and evidence for the SKU. Does not establish the physical backroom quantity.", input_schema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] } },
  { name: "record_investigation", description: "Record a nonbinding investigation finding or request for more evidence. Cannot approve or change inventory.", input_schema: { type: "object", properties: { finding: { type: "string" }, next_action: { type: "string" }, uncertainty: { type: "string" } }, required: ["finding", "next_action", "uncertainty"] } }
];
async function callClaude(messages, system) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 900, system, tools, messages })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Claude API ${response.status}: ${JSON.stringify(body.error ?? body)}`);
  return body;
}
async function runAgent(name, instructions, task) {
  const messages = [{ role: "user", content: task }];
  for (let step = 0; step < 6; step++) {
    const answer = await callClaude(messages, instructions);
    messages.push({ role: "assistant", content: answer.content });
    const calls = answer.content.filter(b => b.type === "tool_use");
    for (const part of answer.content.filter(b => b.type === "text")) console.log(`[${name}] ${part.text}`);
    if (!calls.length) return;
    const results = calls.map(call => {
      let result;
      if (call.name === "get_inventory_evidence") {
        result = call.input?.sku === stock.sku ? stock : { error: "SKU not found" };
      } else if (call.name === "record_investigation") {
        const entry = { actor: name, ...call.input };
        ledger.push(entry);
        result = { recorded: true, entry };
      } else {
        result = { error: "Tool not allowed" };
      }
      console.log(`[${name}] tool=${call.name} result=${JSON.stringify(result)}`);
      return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
    });
    messages.push({ role: "user", content: results });
  }
  console.log(`[${name}] halted: step budget exhausted`);
}
await runAgent("Detection", "You are Lookout Detection. Independently inspect evidence with tools, distinguish observed shelf quantity from recorded on-hand, and document uncertainty. Use tools when useful. Never claim theft or adjust stock.", "Investigate potential availability problems for SKU OAT-01.");
await runAgent("Reconciliation", "You are Lookout Reconciliation. Consider prior findings skeptically, use evidence tools, decide what evidence should be gathered next, and record a recommendation. No inventory changes.", `Review Detection's findings for OAT-01: ${JSON.stringify(ledger)}`);
console.log("Investigation ledger (synthetic, in-memory):", JSON.stringify(ledger, null, 2));
