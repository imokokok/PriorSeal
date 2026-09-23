import pg from 'pg';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';

type RotationRow = { authorization_id: string; expires_at: string | number; acceptance_key_id: string | null; total: string | number };

// Read-only, bounded diagnostics. Uses the operator's connection; no credentials are printed.
export async function rotationImpact(pool: Pick<Pool, 'query'>, nextKeyId: string | undefined, now = Math.floor(Date.now() / 1000)) {
  if (typeof nextKeyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(nextKeyId)) throw new Error('Usage: node --env-file=.env.local scripts/rotation-impact.mjs <next-key-id>');
  const result = await pool.query<RotationRow>(`SELECT authorization_id,expires_at,acceptance_json->>'keyId' AS acceptance_key_id,COUNT(*) OVER() AS total FROM authorizations WHERE bound_tx_hash IS NULL AND acceptance_json->>'keyId' IS DISTINCT FROM $1 ORDER BY expires_at,authorization_id LIMIT 1000`, [nextKeyId]);
  const total = Number(result.rows[0]?.total ?? 0);
  return { schema: 'priorseal.rotation-impact.v1', nextKeyId, checkedAt: now, affectedUnresolvedAuthorizations: total, truncated: total > result.rows.length, scope: 'Unbound server authorization records. Expiry alone does not prove that no transaction was submitted.', nextAction: 'Reconcile any unknown submissions, finish observations with the existing issuer key, then reauthorize only unexecuted intents. Do not re-broadcast from this report.', items: result.rows.map(row => ({ authorizationId: row.authorization_id, acceptanceKeyId: row.acceptance_key_id, expiresAt: Number(row.expires_at), expired: Number(row.expires_at) <= now })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString });
  try { console.log(JSON.stringify(await rotationImpact(pool, process.argv[2]), null, 2)); }
  finally { await pool.end(); }
}
