export function createPostgresWitnessStore(pool) {
  if (!pool?.query) throw new TypeError('createPostgresWitnessStore requires a pg-compatible pool');
  return {
    async get(requestHash, witnessId) {
      const result = await pool.query('SELECT attestation_json FROM witness_attestations WHERE request_hash=$1 AND witness_id=$2', [requestHash, witnessId]);
      return result.rows[0]?.attestation_json;
    },
    async save(requestHash, witnessId, attestation) {
      const result = await pool.query('INSERT INTO witness_attestations (request_hash,witness_id,authorization_hash,observed_at,attestation_json) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (request_hash,witness_id) DO NOTHING RETURNING attestation_json', [requestHash, witnessId, attestation.authorizationHash, attestation.observedAt, attestation]);
      if (result.rows[0]) return result.rows[0].attestation_json;
      return this.get(requestHash, witnessId);
    },
    async health() { await pool.query('SELECT 1'); return 'postgresql'; },
  };
}
