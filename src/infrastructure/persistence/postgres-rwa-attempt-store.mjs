// Generated from postgres-rwa-attempt-store.mts by npm run core:build. Do not edit directly.
import { assertRwaAuthorizationId, createRwaReservation, persistedRwaAttempt, transitionRwaAttempt } from "./rwa-attempt-model.mjs";
const decode = (row) => persistedRwaAttempt(row.record_json, row.authorization_id, row.nonce_key);
function createPostgresRwaAttemptStore(pool) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A pg-compatible pool is required");
  return {
    async get(authorizationId) {
      assertRwaAuthorizationId(authorizationId);
      const result = await pool.query("SELECT authorization_id,nonce_key,record_json FROM rwa_execution_attempts WHERE authorization_id=$1", [authorizationId]);
      return result.rows[0] ? decode(result.rows[0]) : null;
    },
    async reserve(input) {
      const attempt = createRwaReservation(input);
      const result = await pool.query(`INSERT INTO rwa_execution_attempts (authorization_id,nonce_key,record_json) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING authorization_id,nonce_key,record_json`, [attempt.authorizationId, attempt.nonceKey, JSON.stringify(attempt)]);
      if (result.rows[0]) return { claimed: true, attempt: decode(result.rows[0]) };
      const existing = await pool.query("SELECT authorization_id,nonce_key,record_json FROM rwa_execution_attempts WHERE authorization_id=$1 OR nonce_key=$2 ORDER BY (authorization_id=$1) DESC", [attempt.authorizationId, attempt.nonceKey]);
      if (!existing.rows[0]) throw new Error("RWA_CLAIM_DISAPPEARED");
      const stored = decode(existing.rows[0]);
      return { claimed: false, attempt: stored, ...stored.authorizationId !== attempt.authorizationId ? { code: "RWA_NONCE_ALREADY_RESERVED" } : {} };
    },
    async transition(authorizationId, expected, patch) {
      assertRwaAuthorizationId(authorizationId);
      const found = await pool.query("SELECT authorization_id,nonce_key,record_json FROM rwa_execution_attempts WHERE authorization_id=$1", [authorizationId]);
      if (!found.rows[0]) throw new Error("RWA_ATTEMPT_STATE_CONFLICT");
      const previous = decode(found.rows[0]);
      const next = transitionRwaAttempt(previous, expected, patch);
      const changed = await pool.query(`UPDATE rwa_execution_attempts SET record_json=$2::jsonb WHERE authorization_id=$1 AND record_json=$3::jsonb RETURNING authorization_id,nonce_key,record_json`, [authorizationId, JSON.stringify(next), JSON.stringify(previous)]);
      if (!changed.rows[0]) throw new Error("RWA_ATTEMPT_STATE_CONFLICT");
      return decode(changed.rows[0]);
    }
  };
}
export {
  createPostgresRwaAttemptStore
};
