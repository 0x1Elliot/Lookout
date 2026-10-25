export const AGENT_WORKFLOW_VERSION = 1;

export function createAgentWorkflowState() {
  return { version: AGENT_WORKFLOW_VERSION, events: [], cases: [], actions: [] };
}

export function readAgentWorkflowState(value) {
  if (value === undefined) return createAgentWorkflowState();
  if (!value || value.version !== AGENT_WORKFLOW_VERSION
    || !Array.isArray(value.events) || !Array.isArray(value.cases) || !Array.isArray(value.actions)) {
    throw new Error('Agent workflow state is malformed or unsupported.');
  }
  return value;
}

export function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error(`${label} must be a non-empty string of at most 200 characters.`);
  }
  return value;
}
