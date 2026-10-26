import { bearer, fail } from './security.js';
import { sessionHash, sessionCookie } from './auth.js';
import { createAgentInventoryContext } from './agent-context.js';
export function createSecureHandler(store, assets, auth) {
  return async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const path = new URL(request.url, 'http://localhost').pathname;
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (path === '/api/config' && request.method === 'GET') return send(200, { mode: 'secure', authProvider: auth?.config.provider ?? 'api-only' });
    if (!path.startsWith('/api/')) return assets(request, response);
    try {
      if (request.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Cross-site request forbidden.');
      let input;
      if (request.method === 'POST') {
        if (auth && request.headers.origin !== auth.config.origin) throw fail(403, 'Request origin is not allowed.');
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw fail(415, 'Content-Type must be application/json.');
        let size = 0, chunks = [];
        for await (const chunk of request) {
          size += Buffer.byteLength(chunk);
          if (size > (path.startsWith('/api/auth/') ? 16384 : 1_000_000)) throw fail(413, 'Request body is too large.');
          chunks.push(Buffer.from(chunk));
        }
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Invalid JSON.'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Request must be an object.');
      }
      if (auth && ['/api/auth/signup','/api/auth/login'].includes(path) && request.method === 'POST') {
        auth.limit(request.socket.remoteAddress);
        auth.inflight++;
        try {
          if (path.endsWith('/signup')) return send(200, await auth.signup(input));
          const token = await auth.login(input);
          response.setHeader('Set-Cookie', sessionCookie(token, auth.config.secure));
          return send(200, { message: 'Signed in.' });
        } finally { auth.inflight--; }
      }
      const hash = auth ? sessionHash(request.headers, auth.config.secure) : bearer(request.headers);
      if (auth && path === '/api/auth/logout' && request.method === 'POST') {
        await auth.logout(hash);
        response.setHeader('Set-Cookie',sessionCookie('', auth.config.secure, true));
        return send(200,{message:'Signed out.'});
      }
      if (auth && path === '/api/team/invite' && request.method === 'POST') return send(200,await auth.invite(hash,input));
      const read = ['/api/inventory', '/api/agent/workflow', '/api/agent/context'].includes(path);
      if (request.method === 'GET' && read) {
        const state = await store.read(hash);
        return send(200, path.endsWith('/context') ? createAgentInventoryContext(state.inventory) : state);
      }
      if (request.method !== 'POST') throw fail(405, 'Method not allowed.');
      if (!['/api/inventory', '/api/agent/workflow'].includes(path)) throw fail(404, 'API route not found.');
      return send(200, await store.execute(hash, path === '/api/inventory' ? 'inventory' : 'workflow', input));
    } catch (error) {
      const connectionFailure = /^(?:Connection terminated|timeout exceeded when trying to connect|Cannot use a pool after calling end)/.test(error.message);
      const status = error.statusCode ?? (connectionFailure ? 503 : error.code === '23505' ? 409 : error.code === '23503' || error.code === '23514' ? 400
        : error.code ? 503 : /changed since|already|no reviewable/.test(error.message) ? 409 : /unapproved|cannot change inventory/.test(error.message) ? 403 : 400);
      const message = error.code || connectionFailure ? (status === 503 ? 'Database unavailable.' : 'Record conflict or invalid reference.') : error.message;
      send(status, { error: message });
    }
  };
}
