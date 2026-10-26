import { secureConfig } from './security.js';
import { authConfig, AccountAuth } from './auth.js';
import { createPool, verifyRuntime, verifyIdentity } from './db/pool.js';
import { PostgresStore } from './db/store.js';
import { createSecureHandler } from './secure-handler.js';

export async function createApplication(env, assets = (_req,res) => res.writeHead(404).end()) {
  const security = secureConfig(env);
  if (security.mode !== 'secure') throw new Error('Deployed application requires secure mode.');
  const accounts = authConfig(env);
  if (!env.AUTH_DATABASE_URL) throw new Error('AUTH_DATABASE_URL is required; no administrator or runtime fallback exists.');
  const identity = secureConfig({ DATABASE_URL: env.AUTH_DATABASE_URL });
  if (new URL(security.databaseUrl).username === new URL(identity.databaseUrl).username) {
    throw new Error('Inventory and identity connections require separate logins.');
  }
  const pool = createPool(security.databaseUrl), identityPool = createPool(identity.databaseUrl);
  let closing;
  const close = () => closing ??= Promise.all([pool.end(), identityPool.end()]);
  try {
    await verifyRuntime(pool); await verifyIdentity(identityPool);
    const handler = createSecureHandler(new PostgresStore(pool), assets, new AccountAuth(identityPool, accounts));
    return { handler: (req, res) => {
      if (closing) {
        res.writeHead(503, {'Content-Type':'application/json','Cache-Control':'no-store'});
        return res.end(JSON.stringify({error:'Database unavailable.'}));
      }
      return handler(req, res);
    }, close };
  } catch (error) { await close(); throw error; }
}
