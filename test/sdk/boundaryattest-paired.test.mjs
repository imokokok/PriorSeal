import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixtureChecks } from '../../examples/boundaryattest-paired-v0.2/verify.mjs';

test('BoundaryAttest paired fixture passes the documented positive and negative cases', async () => {
  const results = await runFixtureChecks({ log: () => {} });
  assert.deepEqual(results.map((result) => result.code), [
    'OK',
    'EXTERNAL_EVENT_REPLAYED',
    'CONTEXT_COMMITMENT_DIGEST_MISMATCH',
    'STALE_EXTERNAL_EVIDENCE',
    'INVALID_BOUNDARYATTEST_SIGNATURE',
    'BOUNDARYATTEST_KEY_ID_MISMATCH',
  ]);
});
