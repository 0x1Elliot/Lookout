// Lock the workspace before any asynchronous configuration or sign-in request.
export function startWorkspace({ document, connect, mount }) {
  const workspace = document.querySelector('main');
  const controls = document.getElementById('workspace-controls');
  const panel = document.getElementById('startup-panel');
  const message = document.getElementById('startup-message');
  const retry = document.getElementById('startup-retry');
  let ready = false, running = false, mounting = false;
  const lock = () => { controls.disabled = true; workspace.inert = true; workspace.hidden = true; };
  lock();
  // Even after readiness, submissions must go through application handlers.
  document.addEventListener('submit', event => {
    if (!workspace.contains(event.target)) return;
    event.preventDefault();
    if (!ready) event.stopImmediatePropagation();
  }, true);
  async function attempt() {
    if (running || ready) return;
    // A rendering failure may leave partial listeners; restart the page instead
    // of mounting a second controller over that partially initialized workspace.
    if (mounting) { document.defaultView.location.reload(); return; }
    running = true; lock(); panel.hidden = false; retry.hidden = false; retry.disabled = true;
    message.textContent = 'Connecting to Lookout…';
    try {
      const backend = await connect({ onAuthenticating() { panel.hidden = true; } });
      mounting = true;
      await mount(backend);
      ready = true; controls.disabled = false; workspace.inert = false; workspace.hidden = false; panel.hidden = true;
    } catch {
      lock(); panel.hidden = false; retry.disabled = false;
      message.textContent = 'Lookout could not connect to your workspace. Your inventory has not been changed. Try again, or contact the project owner if this continues.';
    } finally { running = false; }
  }
  retry.addEventListener('click', () => { void attempt(); });
  return { attempt, started: attempt() };
}
