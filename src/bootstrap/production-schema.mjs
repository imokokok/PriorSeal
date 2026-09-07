export const REQUIRED_PRODUCTION_MIGRATION = '007_observation_job_results.sql';

export async function assertProductionSchema(pool, { preExecutionProofMode }) {
  const migrations = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  if (!migrations.rows.some((row) => row.name === REQUIRED_PRODUCTION_MIGRATION)) {
    throw new TypeError(`${REQUIRED_PRODUCTION_MIGRATION} is not applied`);
  }

  const requiredTables = ['authorization_log', 'authorizations', 'observation_jobs'];
  if (preExecutionProofMode === 'witness-quorum') requiredTables.push('witness_attestations');
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)", [requiredTables]);
  if (tables.rowCount !== requiredTables.length) throw new TypeError('Required authorization and observation tables are missing');

  const requiredColumns = await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='authorizations' AND column_name='timestamp_evidence_json') OR (table_name='observation_jobs' AND column_name='result_json'))");
  const columns = new Set(requiredColumns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  if (!columns.has('authorizations.timestamp_evidence_json')) throw new TypeError('RFC 3161 timestamp evidence column is missing');
  if (!columns.has('observation_jobs.result_json')) throw new TypeError('Durable observation result column is missing');

  return { migration: REQUIRED_PRODUCTION_MIGRATION, requiredTables };
}
