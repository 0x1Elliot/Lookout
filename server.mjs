import { createServer } from 'node:http';
import { AccountAuth, authConfig } from './server/auth.js';
import { secureConfig } from './server/security.js';
import { createPool, verifyRuntime } from './server/db/pool.js';
import { PostgresStore } from './server/db/store.js';
import { createSecureHandler } from './server/secure-handler.js';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getServerConfig, loadLocalEnv } from './server/config.js';
import { getPublicAsset } from './server/public-assets.js';
import { createAgentInventoryContext } from './server/agent-context.js';
import { createAgentWorkflowService } from './server/agents/workflow.js';

const root = fileURLToPath(new URL('.', import.meta.url));
loadLocalEnv();
const config = getServerConfig();
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function createDemoHandler() {
  const workflow = createAgentWorkflowService();
  return async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;

  if (pathname === '/api/config' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ mode: 'demo' })); return;
  }

  if (pathname === '/api/agent/workflow') {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ workflow: workflow.getState() }));
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST', 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Method not allowed.' }));
      return;
    }
    const contentType = request.headers['content-type'];
    if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      response.writeHead(415, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Content-Type must be application/json.' }));
      return;
    }
    let body = '';
    try {
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 1_000_000) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
      }
      let input;
      try { input = JSON.parse(body); } catch { throw Object.assign(new Error('Invalid JSON.'), { statusCode: 400 }); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Workflow request must be an object.'), { statusCode: 400 });
      let result;
      if (input.stage === 'intake') {
        const value = workflow.intake(input.event);
        result = { event: value.event, duplicate: value.duplicate };
      } else if (input.stage === 'reconcile') {
        const value = workflow.reconcile(input.eventId, input.inventory);
        result = { caseRecord: value.caseRecord, duplicate: value.duplicate };
      } else if (input.stage === 'review') {
        const value = workflow.review(input.caseId, input.decision);
        result = { caseRecord: value.caseRecord, duplicate: value.duplicate };
      } else if (input.stage === 'action') {
        const value = workflow.act(input.caseId, input.request, input.inventory);
        result = {
          action: value.action,
          duplicate: value.duplicate,
          inventory: value.inventory,
          context: createAgentInventoryContext(value.inventory),
        };
      } else {
        throw Object.assign(new Error('stage must be intake, reconcile, review, or action.'), { statusCode: 400 });
      }
      result.workflow = workflow.getState();
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(result));
    } catch (error) {
      const status = error.statusCode ?? (/unapproved|cannot change inventory/i.test(error.message) ? 403
        : /already exists|already recorded|already been executed|changed since reconciliation|already belongs|no reviewable/i.test(error.message) ? 409 : 400);
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (pathname === '/api/agent/context') {
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end('Method not allowed');
      return;
    }

    const contentType = request.headers['content-type'];
    if (contentType && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      response.writeHead(415, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Content-Type must be application/json.' }));
      return;
    }

    let body = '';
    try {
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 1_000_000) throw new Error('Request body is too large.');
      }
      let input;
      try {
        input = JSON.parse(body);
      } catch {
        const error = new Error('Invalid JSON.');
        error.code = 'INVALID_JSON';
        throw error;
      }
      const context = createAgentInventoryContext(input);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(context));
    } catch (error) {
      const isTooLarge = error.message === 'Request body is too large.';
      response.writeHead(isTooLarge ? 413 : 400, { 'content-type': 'application/json; charset=utf-8' });
      const message = isTooLarge || error.code === 'INVALID_JSON' ? error.message : 'Invalid inventory context request.';
      response.end(JSON.stringify({ error: message }));
    }
    return;
  }

  const publicFile = getPublicAsset(pathname);

  if (!publicFile) {
    response.writeHead(404).end('Not found');
    return;
  }

  try {
    const filePath = join(root, publicFile);
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
  };
}

export function createDemoServer() {
  return createServer(createDemoHandler());
}

// The application factory always validates its deployment mode before exposing routes.
export async function createLookoutServer(env = process.env) {
  const security = secureConfig(env);
  if (security.mode === 'demo') return createDemoServer();
  const accounts = authConfig(env);
  const pool = createPool(security.databaseUrl);
  try {
    await verifyRuntime(pool);
    const server = createServer(createSecureHandler(new PostgresStore(pool), createDemoHandler(), new AccountAuth(pool, accounts)));
    server.once('close', () => { void pool.end(); });
    return server;
  } catch (error) { await pool.end(); throw error; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = await createLookoutServer();
  if (process.env.LOOKOUT_MODE === 'demo') console.warn('LOCAL DEMO: no authentication or durable backend. Synthetic data only.');
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const shutdown = () => server.close();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Lookout is running at http://127.0.0.1:${config.port}`);
  });
}
