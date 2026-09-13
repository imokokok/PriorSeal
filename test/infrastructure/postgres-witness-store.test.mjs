import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresWitnessStore } from '../../src/infrastructure/witness/postgres-witness-store.mjs';

test('Postgres witness readiness checks the required attestation table', async () => {
  const calls = [];
  const store = createPostgresWitnessStore({
    async query(sql) { calls.push(sql); return { rows: [] }; },
  });
  assert.equal(await store.health(), 'postgresql');
  assert.deepEqual(calls, ['SELECT 1 FROM witness_attestations LIMIT 0']);
});
