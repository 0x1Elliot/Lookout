// Session credentials stay in an HttpOnly cookie; application code never reads them.
export async function connectBackend({ onAuthenticating = () => {} } = {}) {
  // Email confirmation may redirect with provider tokens; this app uses password login instead.
  if (/access_token=|refresh_token=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  const configResponse = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!configResponse.ok) throw new Error('Cannot determine backend security mode.');
  const config = await configResponse.json();
  if (config.mode === 'demo') {
    document.querySelector('footer').textContent = 'LOCAL DEMO · Browser inventory and unauthenticated, temporary workflow. Synthetic data only.';
    return null;
  }
  if (config.mode !== 'secure') throw new Error('Unknown backend mode.');
  const main = document.querySelector('main'); main.hidden = true;
  document.getElementById('agent-mode').textContent = 'AUTHENTICATED WORKFLOW';
  document.getElementById('agent-description').textContent = 'Synthetic test events. Four deterministic stages. A reviewer approves the evidence; a different authorized worker applies the count.';
  document.getElementById('agent-persistence').textContent = 'Inventory, cases and audit records are saved on the server. Load saved cases to continue after signing in or restarting. Reviewer identity comes from your account.';
  document.querySelector('.status-pill').textContent = 'Shared server inventory';
  const section = document.createElement('section'); section.className = 'panel auth-shell'; section.hidden = true;
  const title = document.createElement('h1'); title.textContent = 'Welcome to Lookout';
  const help = document.createElement('p'); help.textContent = config.authProvider === 'local-dev'
    ? 'Local development: email addresses are not verified. Use a test email and a password you do not use elsewhere.'
    : 'Sign in with your email and password. New here? Create an account below.';
  const form = document.createElement('form'); form.className = 'form-grid';
  const makeField = (text, type, autocomplete) => {
    const label = document.createElement('label'); label.className = 'field field-wide';
    const caption = document.createElement('span'); caption.textContent = text;
    const field = document.createElement('input'); field.type = type; field.required = true; field.autocomplete = autocomplete;
    label.append(caption, field); form.append(label); return { field, label };
  };
  const name = makeField('Your name', 'text', 'name'); name.field.maxLength = 200; name.label.hidden = true; name.field.required = false;
  const email = makeField('Email', 'email', 'username'); email.field.maxLength = 254;
  const password = makeField('Password', 'password', 'current-password'); password.field.minLength = 12; password.field.maxLength = 128;
  const passwordHint = document.createElement('p'); passwordHint.textContent = 'Use at least 12 characters.';
  const button = document.createElement('button'); button.className = 'button button-primary'; button.textContent = 'Sign in';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'button button-secondary'; toggle.textContent = 'Create an account';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  let signup = false;
  toggle.addEventListener('click', () => {
    signup = !signup; name.label.hidden = !signup; name.field.required = signup;
    password.field.autocomplete = signup ? 'new-password' : 'current-password';
    button.textContent = signup ? 'Sign up' : 'Sign in'; toggle.textContent = signup ? 'Back to sign in' : 'Create an account'; status.textContent = '';
  });
  form.append(passwordHint, button); section.append(title, help, form, toggle, status); document.body.prepend(section);
  let revision, identity, pending = false, pendingMutation;
  async function request(path, input) {
    if (pending) throw new Error('Another request is running. Try again when it finishes.');
    pending = true;
    try {
    const response = await fetch(path, { method: input ? 'POST' : 'GET', cache: 'no-store', headers: {
      ...(input ? { 'Content-Type': 'application/json' } : {}),
    }, ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error ?? 'Request failed.'), { statusCode: response.status });
    if (result.revision !== undefined) revision = result.revision;
    return result;
    } finally { pending = false; }
  }
  const initial = await new Promise((resolve, reject) => {
    form.addEventListener('submit', async event => {
      event.preventDefault(); button.disabled = true; toggle.disabled = true;
      try {
        const result = await request(signup ? '/api/auth/signup' : '/api/auth/login', { email: email.field.value, password: password.field.value, ...(signup ? { name: name.field.value } : {}) });
        password.field.value = '';
        if (signup) { status.textContent = result.message; return; }
        const state = await request('/api/inventory'); identity = state.identity; section.remove(); resolve(state);
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; toggle.disabled = false; }
    });
    void (async () => {
      try {
        const state = await request('/api/inventory'); identity = state.identity; section.remove(); resolve(state);
      } catch (error) {
        if (error.statusCode === 401) { section.hidden = false; onAuthenticating(); }
        else { section.remove(); reject(new Error('Workspace initialization unavailable.')); }
      }
    })();
  });
  const footer = document.querySelector('footer'); footer.textContent = `Signed in as ${identity.name} (${identity.role}). Inventory is saved on the server. `;
  const logout = document.createElement('button'); logout.textContent = 'Sign out';
  logout.addEventListener('click', async () => {
    try { await request('/api/auth/logout', {}); location.reload(); }
    catch (error) { status.textContent = error.message; footer.append(status); }
  }); footer.append(logout);
  if (identity.role === 'admin') {
    const team = document.createElement('section'); team.className = 'panel';
    const heading = document.createElement('h2'); heading.textContent = 'Invite a teammate';
    const explanation = document.createElement('p'); explanation.textContent = 'Prepare a role for a new teammate before they sign up. Share this site address with them. Existing accounts already belong to their own workspace.';
    const inviteForm = document.createElement('form'); inviteForm.className = 'form-grid';
    const label = document.createElement('label'); label.className = 'field'; const caption = document.createElement('span'); caption.textContent = 'Teammate email';
    const field = document.createElement('input'); field.type = 'email'; field.required = true; label.append(caption,field);
    const roleLabel = document.createElement('label'); roleLabel.className = 'field'; const roleCaption = document.createElement('span'); roleCaption.textContent = 'Teammate role';
    const role = document.createElement('select'); role.add(new Option('Worker', 'worker')); role.add(new Option('Reviewer', 'reviewer')); roleLabel.append(roleCaption,role);
    const inviteButton = document.createElement('button'); inviteButton.className = 'button button-primary'; inviteButton.textContent = 'Prepare invitation';
    const resultText = document.createElement('p'); resultText.setAttribute('role','status');
    inviteForm.append(label,roleLabel,inviteButton); team.append(heading,explanation,inviteForm,resultText); footer.before(team);
    inviteForm.addEventListener('submit',async event => {
      event.preventDefault(); inviteButton.disabled=true;
      try { const result=await request('/api/team/invite',{email:field.value,role:role.value}); resultText.textContent=result.message; inviteForm.reset(); }
      catch(error) { resultText.textContent=error.message; }
      finally { inviteButton.disabled=false; }
    });
  }
  const reviewer = document.getElementById('agent-reviewer'); reviewer.value = identity.name; reviewer.readOnly = true;
  return {
    initial,
    async read() { const result = await request('/api/inventory'); pendingMutation = undefined; return result; },
    async mutate(operation, args) {
      const signature = JSON.stringify({ operation, args });
      if (pendingMutation && pendingMutation.signature !== signature) throw new Error('An earlier stock request has an uncertain result. Refresh inventory before another change.');
      pendingMutation ??= { signature, body: { operation, ...args, expectedRevision: revision, requestId: crypto.randomUUID() } };
      try {
        const result = await request('/api/inventory', pendingMutation.body);
        pendingMutation = undefined; return result;
      } catch (error) {
        if (error.statusCode && error.statusCode < 500) pendingMutation = undefined;
        throw error;
      }
    },
    async workflow(input) {
      const { inventory, ...trustedInput } = input;
      const result = await request('/api/agent/workflow', { ...trustedInput, requestId: input.stage === 'action' ? `apply:${input.request.actionRequestId}` : crypto.randomUUID() });
      if (input.stage !== 'action') return result;
      // A durable replay may contain an older snapshot; show the current server state.
      const latest = await request('/api/inventory');
      return { ...result, inventory: latest.inventory, workflow: latest.workflow, revision: latest.revision };
    },
  };
}
