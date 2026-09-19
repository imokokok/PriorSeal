import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionSchema, assertWitnessSchema, REQUIRED_PRODUCTION_MIGRATION, REQUIRED_WITNESS_MIGRATION } from '../../src/bootstrap/production-schema.mjs';

function database({ migration = true, resultColumn = true, leaseColumns = true, archive = false } = {}) {
  return {
    async query(sql, parameters) {
      if (sql.startsWith('SELECT name FROM schema_migrations')) return { rows: migration ? [{ name: REQUIRED_PRODUCTION_MIGRATION }, ...(archive ? [{ name: '009_project_evidence_archive.sql' }] : [])] : [{ name: '006_rfc3161_timestamp.sql' }] };
      if (sql.includes('information_schema.tables')) return { rowCount: parameters[0].length, rows: parameters[0].map((table_name) => ({ table_name })) };
      if (sql.includes('information_schema.columns')) return { rows: [{ table_name: 'authorizations', column_name: 'timestamp_evidence_json' }, ...(resultColumn ? [{ table_name: 'observation_jobs', column_name: 'result_json' }] : []), ...(leaseColumns ? [{ table_name: 'observation_jobs', column_name: 'lease_token' }, { table_name: 'observation_jobs', column_name: 'lease_expires_at' }] : [])] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('production schema requires migration 008 and its durable result and lease columns', async () => {
  await assert.rejects(() => assertProductionSchema(database({ migration: false }), { preExecutionProofMode: 'rfc3161' }), /008_observation_job_leases/);
  await assert.rejects(() => assertProductionSchema(database({ resultColumn: false }), { preExecutionProofMode: 'rfc3161' }), /Durable observation result column/);
  await assert.rejects(() => assertProductionSchema(database({ leaseColumns: false }), { preExecutionProofMode: 'rfc3161' }), /lease columns/);
  const ready = await assertProductionSchema(database(), { preExecutionProofMode: 'rfc3161' });
  assert.equal(ready.migration, REQUIRED_PRODUCTION_MIGRATION);
  assert.deepEqual(ready.requiredTables, ['authorization_log', 'authorizations', 'observation_jobs']);
});

test('enabling the project archive requires its recorded migration and scoped table', async () => {
  await assert.rejects(assertProductionSchema(database(), { preExecutionProofMode: 'rfc3161', archiveEnabled: true }), /009_project_evidence_archive/);
  const ready = await assertProductionSchema(database({ archive: true }), { preExecutionProofMode: 'rfc3161', archiveEnabled: true });
  assert.equal(ready.requiredTables.at(-1), 'project_evidence_archive');
});

test('production schema requires the witness table in witness-quorum mode', async () => {
  const ready = await assertProductionSchema(database(), { preExecutionProofMode: 'witness-quorum' });
  assert.equal(ready.requiredTables.at(-1), 'witness_attestations');
});

test('standalone witness startup requires its recorded migration and table', async () => {
  const calls = [];
  const witnessDatabase = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT name FROM schema_migrations')) return { rows: [{ name: REQUIRED_WITNESS_MIGRATION }] };
      if (sql.startsWith('SELECT 1 FROM witness_attestations')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  assert.deepEqual(await assertWitnessSchema(witnessDatabase), { migration: REQUIRED_WITNESS_MIGRATION, table: 'witness_attestations' });
  await assert.rejects(() => assertWitnessSchema({ query: async () => ({ rows: [] }) }), /005_witness_quorum/);
  assert.equal(calls.at(-1), 'SELECT 1 FROM witness_attestations LIMIT 0');
});
