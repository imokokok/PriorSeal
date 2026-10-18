-- Admit Solana Ed25519 authorizers: rebuild authorizations with an extended
-- authorizer_type CHECK. SQLite cannot ALTER a CHECK constraint, so copy the
-- existing rows into a new table and swap. No other table references
-- authorizations; the two secondary indexes are recreated explicitly.
CREATE TABLE authorizations_new (
  authorization_id TEXT PRIMARY KEY,
  authorization_hash TEXT NOT NULL UNIQUE,
  intent_hash TEXT NOT NULL REFERENCES intents(intent_hash),
  principal_id TEXT NOT NULL,
  principal_account TEXT NOT NULL,
  authorizer_address TEXT NOT NULL,
  authorizer_type TEXT NOT NULL CHECK (authorizer_type IN ('eip712','eip1271','solana-ed25519')),
  executor_address TEXT NOT NULL,
  authorization_nonce TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses = 1),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses BETWEEN 0 AND max_uses),
  status TEXT NOT NULL CHECK (status IN ('ACCEPTED','BOUND','REVOKED')),
  bound_tx_hash TEXT,
  authorization_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  witness_evidence_json TEXT,
  timestamp_evidence_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  log_sequence INTEGER REFERENCES authorization_log(sequence)
);
INSERT INTO authorizations_new (
  authorization_id, authorization_hash, intent_hash, principal_id, principal_account,
  authorizer_address, authorizer_type, executor_address, authorization_nonce, expires_at,
  max_uses, uses, status, bound_tx_hash, authorization_json, acceptance_json, policy_json,
  witness_evidence_json, timestamp_evidence_json, created_at, log_sequence
)
SELECT
  authorization_id, authorization_hash, intent_hash, principal_id, principal_account,
  authorizer_address, authorizer_type, executor_address, authorization_nonce, expires_at,
  max_uses, uses, status, bound_tx_hash, authorization_json, acceptance_json, policy_json,
  witness_evidence_json, timestamp_evidence_json, created_at, log_sequence
FROM authorizations;
DROP TABLE authorizations;
ALTER TABLE authorizations_new RENAME TO authorizations;
CREATE INDEX authorizations_principal_idx ON authorizations(principal_id, created_at DESC);
CREATE INDEX authorizations_executor_idx ON authorizations(executor_address, created_at DESC);
