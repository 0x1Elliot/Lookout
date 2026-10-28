import { secureConfig } from './security.js';
import { authConfig, AccountAuth } from './auth.js';
import { createPool, verifyRuntime, verifyIdentity } from './db/pool.js';
import { PostgresStore } from './db/store.js';
import { createSecureHandler } from './secure-handler.js';
import { startupFailure } from './startup-diagnostics.js';

export async function createApplication(env, assets = (_req,res) => res.writeHead(404).end()) {
  const required = ['DATABASE_URL', 'AUTH_DATABASE_URL'];
  if (env.LOOKOUT_AUTH !== 'local-dev') required.push('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'APP_ORIGIN');
  if (required.some(key => !env[key])) throw startupFailure('configuration_missing');
  let security, accounts, identity;
  try {
    security = secureConfig(env);
    if (security.mode !== 'secure') throw new Error('Deployed application requires secure mode.');
    accounts = authConfig(env);
    identity = secureConfig({ DATABASE_URL: env.AUTH_DATABASE_URL });
    if (new URL(security.databaseUrl).username === new URL(identity.databaseUrl).username) {
      throw new Error('Inventory and identity connections require separate logins.');
    }
  } catch { throw startupFailure('configuration_invalid'); }
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
