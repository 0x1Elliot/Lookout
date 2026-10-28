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

// Order-insensitive serialization for comparing JSON-like values by meaning.
// Object keys are sorted recursively; array order is preserved because it can be meaningful.
// PostgreSQL jsonb does not preserve object key order, so JSON.stringify alone is not
// safe for comparing a stored document with a freshly built object.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}
