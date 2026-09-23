// Generated from postgres-witness-store.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresWitnessStore } from "../../src/infrastructure/witness/postgres-witness-store.mjs";
import { testPostgresPool } from "../support/postgres.mjs";
test("Postgres witness readiness checks the required attestation table", async () => {
  const calls = [];
  const store = createPostgresWitnessStore(testPostgresPool({
    async query(sql) {
      calls.push(sql);
      return { rows: [] };
    }
  }));
  assert.equal(await store.health(), "postgresql");
  assert.deepEqual(calls, ["SELECT 1 FROM witness_attestations LIMIT 0"]);
});
