import { fileURLToPath } from 'node:url';

const defaultEnvPath = fileURLToPath(new URL('../.env', import.meta.url));

export function loadLocalEnv(envPath = defaultEnvPath) {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function getServerConfig(env = process.env) {
  const rawPort = env.PORT ?? '4173';
  if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort)) {
    throw new Error('PORT must be a whole number from 1 to 65535.');
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a whole number from 1 to 65535.');
  }

  return Object.freeze({ port });
}

export function getAnthropicApiKey(env = process.env) {
  const value = env.ANTHROPIC_API_KEY;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('ANTHROPIC_API_KEY must be text.');
  return value.trim() || undefined;
}
