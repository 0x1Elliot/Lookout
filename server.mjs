import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getServerConfig, loadLocalEnv } from './server/config.js';
import { getPublicAsset } from './server/public-assets.js';

const root = fileURLToPath(new URL('.', import.meta.url));
loadLocalEnv();
const config = getServerConfig();
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
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
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Lookout is running at http://127.0.0.1:${config.port}`);
});
