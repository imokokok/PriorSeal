ALTER TABLE authorizations
  ADD COLUMN IF NOT EXISTS witness_evidence_json JSONB;

CREATE TABLE IF NOT EXISTS witness_attestations (
  request_hash TEXT NOT NULL,
  witness_id TEXT NOT NULL,
  authorization_hash TEXT NOT NULL,
  observed_at BIGINT NOT NULL,
  attestation_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_hash, witness_id)
);

CREATE INDEX IF NOT EXISTS witness_attestations_authorization_idx
  ON witness_attestations(authorization_hash, observed_at);
