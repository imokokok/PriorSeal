export const REQUIRED_PRODUCTION_MIGRATION = '010_authorization_merkle_index.sql';
export const REQUIRED_WITNESS_MIGRATION = '005_witness_quorum.sql';

export async function assertProductionSchema(pool: Pool | null, { preExecutionProofMode, archiveEnabled = false }: { preExecutionProofMode?: string; archiveEnabled?: boolean }) {
  if (!pool) throw new TypeError('Production schema requires a PostgreSQL pool');
  const migrations = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  if (!migrations.rows.some((row) => row.name === REQUIRED_PRODUCTION_MIGRATION)) {
    throw new TypeError(`${REQUIRED_PRODUCTION_MIGRATION} is not applied`);
  }

  if (archiveEnabled && !migrations.rows.some((row) => row.name === '009_project_evidence_archive.sql')) throw new TypeError('009_project_evidence_archive.sql is not applied');
  const requiredTables = ['authorization_log', 'authorization_log_merkle_nodes', 'authorizations', 'observation_jobs'];
  if (archiveEnabled) requiredTables.push('project_evidence_archive');
  if (preExecutionProofMode === 'witness-quorum') requiredTables.push('witness_attestations');
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)", [requiredTables]);
  if (tables.rowCount !== requiredTables.length) throw new TypeError('Required authorization and observation tables are missing');

  const requiredColumns = await pool.query<{ table_name: string; column_name: string }>("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='authorizations' AND column_name='timestamp_evidence_json') OR (table_name='observation_jobs' AND column_name IN ('result_json','lease_token','lease_expires_at')))");
  const columns = new Set(requiredColumns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  if (!columns.has('authorizations.timestamp_evidence_json')) throw new TypeError('RFC 3161 timestamp evidence column is missing');
  if (!columns.has('observation_jobs.result_json')) throw new TypeError('Durable observation result column is missing');
  if (!columns.has('observation_jobs.lease_token') || !columns.has('observation_jobs.lease_expires_at')) throw new TypeError('Durable observation lease columns are missing');

  return { migration: REQUIRED_PRODUCTION_MIGRATION, requiredTables };
}

export async function assertWitnessSchema(pool: Pool | null) {
  if (!pool) throw new TypeError('Witness schema requires a PostgreSQL pool');
  const migrations = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  if (!migrations.rows.some((row) => row.name === REQUIRED_WITNESS_MIGRATION)) throw new TypeError(`${REQUIRED_WITNESS_MIGRATION} is not applied`);
  await pool.query('SELECT 1 FROM witness_attestations LIMIT 0');
  return { migration: REQUIRED_WITNESS_MIGRATION, table: 'witness_attestations' };
}
import type { Pool } from 'pg';
