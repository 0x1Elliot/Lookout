import { Readable, Writable } from 'node:stream';
import { isIP } from 'node:net';
import { createApplication } from './application.js';
import { startupFailure, reportStartupFailure } from './startup-diagnostics.js';

// Bridge the Web-standard Vercel entry point to the same streaming Node handler
// used locally. Limits, CSRF, authentication and authorization stay in one place.
export function createDeploymentHandler({ env = process.env, initialize = createApplication, log = console.error } = {}) {
  let initialized;
  return async function handle(request) {
    let app;
    try {
      if (['NODE_ENV', 'LOOKOUT_MODE', 'LOOKOUT_AUTH'].some(key => !env[key])) {
        throw startupFailure('configuration_missing');
      }
      if (env.NODE_ENV !== 'production' || env.LOOKOUT_MODE !== 'secure' || env.LOOKOUT_AUTH !== 'supabase') {
        throw startupFailure('configuration_invalid');
      }
      initialized ??= initialize(env).catch(error => { initialized = undefined; throw error; });
      app = await initialized;
    } catch (error) {
      reportStartupFailure(error, log);
      return Response.json({error:'Application configuration unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});
    }
    const url = new URL(request.url);
    if (['/api','/api/index'].includes(url.pathname)) {
      const route = url.searchParams.get('route') ?? '';
      if (!/^[a-z0-9/-]*$/.test(route) || route.includes('..')) return new Response('Not found',{status:404});
      url.pathname = '/api/' + route; url.searchParams.delete('route');
    }
    if (!url.pathname.startsWith('/api/')) return new Response('Not found',{status:404});
    const req = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
    req.url = url.pathname + url.search; req.method = request.method;
    req.headers = Object.fromEntries(request.headers);
    // Vercel overwrites forwarded-for at its trusted ingress. Ignore that header
    // outside Vercel, and never use it to establish account or tenant authority.
    const forwarded = env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for') : null;
    req.socket = {remoteAddress: forwarded && isIP(forwarded) ? forwarded : 'deployment'};
    const headers = new Headers(), chunks = [];
    const res = new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}});
    let status = 200;
    res.setHeader = (name,value) => headers.set(name,String(value));
    res.writeHead = (code,values={}) => { status=code; for(const [key,value] of Object.entries(values))headers.set(key,String(value));return res; };
    try {
      await app.handler(req,res);
      if (!res.writableEnded) res.end();
      return new Response(Buffer.concat(chunks),{status,headers});
    } catch {
      return Response.json({error:'Request could not be completed.'},{status:503,headers:{'Cache-Control':'no-store'}});
    }
  };
}
