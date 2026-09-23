import pg from 'pg';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Explicit allowlist and dependency order keep this export read-only and deterministic.
const tables = [
  ['intents', 'id'],
  ['authorization_log', 'sequence'],
  ['authorization_log_merkle_nodes', 'start_sequence,level'],
  ['authorizations', 'created_at,authorization_id'],
  ['execution_observations', 'id'],
  ['receipts', 'receipt_id'],
  ['idempotency_records', 'scope,idempotency_key'],
  ['observation_jobs', 'job_id'],
  ['project_evidence_archive', 'sequence'],
  ['witness_attestations', 'request_hash,witness_id'],
];
const timestampColumns = new Set(['created_at', 'updated_at', 'expires_at', 'next_attempt_at', 'lease_expires_at']);
const output = process.argv[2];
if (!output || !output.startsWith('/private/tmp/priorseal-d1-') || !output.endsWith('.sql')) {
  throw new Error('Usage: node --env-file=.env.local scripts/export-neon-to-d1.mjs /private/tmp/priorseal-d1-<name>.sql');
}
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('A Neon read-only source connection is required');

const literal = (value) => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const convert = (column, value) => {
  if (value == null) return null;
  if (column.endsWith('_json') || column === 'reason_codes') return JSON.stringify(value);
  if (timestampColumns.has(column) && value instanceof Date) return value.getTime();
  return value;
};
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 20_000 });
await client.connect();
try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const lines = ['PRAGMA foreign_keys=ON;'];
  const summary = [];
  for (const [table, order] of tables) {
    const { rows } = await client.query(`SELECT * FROM public.${table} ORDER BY ${order}`);
    const digest = createHash('sha256');
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map((column) => convert(column, row[column]));
      digest.update(JSON.stringify([columns, values]));
      lines.push(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${values.map(literal).join(',')});`);
    }
    summary.push({ table, rows: rows.length, sha256: digest.digest('hex') });
  }
  await client.query('COMMIT');
  await writeFile(output, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ output, summary }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
