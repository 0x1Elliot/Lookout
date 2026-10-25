import test from 'node:test';
import { inProcessTransport, runApiChecks } from '../../scripts/check-agent-api.mjs';
test('direct API scenarios cover validation, approval constraints, stale revisions, rejection and idempotency', async () => {
  await runApiChecks(inProcessTransport());
});
