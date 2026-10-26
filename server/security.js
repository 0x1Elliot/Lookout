import { createHash } from 'node:crypto';
export const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function bearer(headers) {
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(headers.authorization ?? '');
  if (!match) throw fail(401, 'Authentication required.');
  return tokenHash(match[1]);
}
const permissions = {
  worker: ['read', 'intake', 'reconcile', 'action', 'add', 'receive', 'begin', 'finish'],
  reviewer: ['read', 'review'],
  admin: ['read', 'intake', 'reconcile', 'review', 'action', 'add', 'receive', 'begin', 'finish'],
};
export function authorize(principal, operation) {
  if (!permissions[principal.role]?.includes(operation)) throw fail(403, 'Operation forbidden.');
}
export function secureConfig(env = process.env) {
  const mode = env.LOOKOUT_MODE ?? 'secure';
  if (!['secure', 'demo'].includes(mode)) throw new Error('LOOKOUT_MODE must be secure or demo.');
  if (mode === 'demo') {
    if (env.NODE_ENV === 'production') throw new Error('Demo mode is forbidden in production.');
    return { mode };
  }
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL is required in secure mode.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && url.searchParams.get('sslmode') !== 'verify-full') throw new Error('Remote PostgreSQL requires sslmode=verify-full.');
  if (url.searchParams.has('ssl') || url.searchParams.has('uselibpqcompat')) throw new Error('Unsupported database TLS override.');
  return { mode, databaseUrl: env.DATABASE_URL };
}
