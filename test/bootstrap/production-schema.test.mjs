import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionSchema, REQUIRED_PRODUCTION_MIGRATION } from '../../src/bootstrap/production-schema.mjs';

function database({ migration = true, resultColumn = true, witness = false } = {}) {
  return {
    async query(sql, parameters) {
      if (sql.startsWith('SELECT name FROM schema_migrations')) return { rows: migration ? [{ name: REQUIRED_PRODUCTION_MIGRATION }] : [{ name: '006_rfc3161_timestamp.sql' }] };
      if (sql.includes('information_schema.tables')) return { rowCount: parameters[0].length, rows: parameters[0].map((table_name) => ({ table_name })) };
      if (sql.includes('information_schema.columns')) return { rows: [{ table_name: 'authorizations', column_name: 'timestamp_evidence_json' }, ...(resultColumn ? [{ table_name: 'observation_jobs', column_name: 'result_json' }] : [])] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('production schema requires migration 007 and its durable result column', async () => {
  await assert.rejects(() => assertProductionSchema(database({ migration: false }), { preExecutionProofMode: 'rfc3161' }), /007_observation_job_results/);
  await assert.rejects(() => assertProductionSchema(database({ resultColumn: false }), { preExecutionProofMode: 'rfc3161' }), /Durable observation result column/);
  const ready = await assertProductionSchema(database(), { preExecutionProofMode: 'rfc3161' });
  assert.equal(ready.migration, REQUIRED_PRODUCTION_MIGRATION);
  assert.deepEqual(ready.requiredTables, ['authorization_log', 'authorizations', 'observation_jobs']);
});

test('production schema requires the witness table in witness-quorum mode', async () => {
  const ready = await assertProductionSchema(database({ witness: true }), { preExecutionProofMode: 'witness-quorum' });
  assert.equal(ready.requiredTables.at(-1), 'witness_attestations');
});
