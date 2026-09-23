import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const sourceFile = process.argv[2];
if (!sourceFile?.startsWith('/private/tmp/priorseal-d1-') || !sourceFile.endsWith('.sql')) throw new Error('Pass the protected migration SQL snapshot path');
const tables = [
  ['intents', 'id'], ['authorization_log', 'sequence'], ['authorization_log_merkle_nodes', 'start_sequence,level'],
  ['authorizations', 'created_at,authorization_id'], ['execution_observations', 'id'], ['receipts', 'receipt_id'],
  ['idempotency_records', 'scope,idempotency_key'], ['observation_jobs', 'job_id'],
  ['project_evidence_archive', 'sequence'], ['witness_attestations', 'request_hash,witness_id'],
];
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../d1/migrations/0001_initial.sql', import.meta.url), 'utf8'));
sqlite.exec(readFileSync(sourceFile, 'utf8'));
const digest = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
let matched = 0;
try {
  for (const [table, order] of tables) {
    const sql = `SELECT * FROM ${table} ORDER BY ${order}`;
    const expected = sqlite.prepare(sql).all();
    const child = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'priorseal-production', '--remote', '--command', sql, '--json'], {
      encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, WRANGLER_LOG_PATH: '/private/tmp/priorseal-wrangler-d1.log' },
    });
    if (child.status !== 0) throw new Error(`Remote read failed for ${table}: ${child.stderr.slice(0, 500)}`);
    const response = JSON.parse(child.stdout);
    if (!Array.isArray(response) || !response[0]?.success) throw new Error(`Remote read failed for ${table}`);
    const actual = response[0].results;
    if (expected.length !== actual.length || digest(expected) !== digest(actual)) throw new Error(`D1 import mismatch for ${table}: expected ${expected.length}, got ${actual.length}`);
    console.log(`${table}: ${actual.length} rows, SHA-256 ${digest(actual)} match`);
    matched += actual.length;
  }
  const violations = sqlite.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`${violations.length} foreign key violations in source snapshot`);
  console.log(`Verified ${matched} complete rows across ${tables.length} tables; no foreign key violations`);
} finally {
  sqlite.close();
}
