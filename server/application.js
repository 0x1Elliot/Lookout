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
  const close = async () => { await Promise.all([pool.end(), identityPool.end()]); };
  try {
    await verifyRuntime(pool); await verifyIdentity(identityPool);
    return { handler: createSecureHandler(new PostgresStore(pool), assets, new AccountAuth(identityPool, accounts)), close };
  } catch (error) { await close(); throw error; }
}
