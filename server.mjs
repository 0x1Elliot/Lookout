import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getServerConfig, loadLocalEnv } from './server/config.js';
import { getPublicAsset } from './server/public-assets.js';
import { createAgentInventoryContext } from './server/agent-context.js';

const root = fileURLToPath(new URL('.', import.meta.url));
loadLocalEnv();
const config = getServerConfig();
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function createLookoutHandler() {
  return async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;

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

export function createLookoutServer() {
  return createServer(createLookoutHandler());
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = createLookoutServer();
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Lookout is running at http://127.0.0.1:${config.port}`);
  });
}
