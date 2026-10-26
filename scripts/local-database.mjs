import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { localPostgres } from './lib/local-postgres.mjs';
const local = await localPostgres(resolve('work/local-db'), Number(process.env.LOCAL_DB_PORT ?? 55432));
await local.owner.end();
console.log('Local secure demo: real PostgreSQL with email/password sign-up.');
console.log('Development only: email ownership is not verified. Do not use real passwords or personal data.');
console.log('Open http://127.0.0.1:4173, create an account, then sign in.');
const child = spawn(process.execPath, ['server.mjs'], { stdio: 'inherit', env: { ...process.env, LOOKOUT_MODE: 'secure', LOOKOUT_AUTH: 'local-dev', APP_ORIGIN: 'http://127.0.0.1:4173', DATABASE_URL: local.runtimeUrl } });
let stopping = false;
async function stop() { if (stopping) return; stopping = true; child.kill('SIGTERM'); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
child.once('exit', async code => { await local.db.stop(); process.exitCode = code ?? 0; });
