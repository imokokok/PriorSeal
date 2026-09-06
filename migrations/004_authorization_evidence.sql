CREATE TABLE IF NOT EXISTS authorization_log (
  sequence BIGSERIAL PRIMARY KEY,
  authorization_hash TEXT NOT NULL UNIQUE,
  accepted_at BIGINT NOT NULL,
  previous_entry_hash TEXT,
  entry_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authorizations (
  authorization_id TEXT PRIMARY KEY,
  authorization_hash TEXT NOT NULL UNIQUE,
  intent_hash TEXT NOT NULL REFERENCES intents(intent_hash),
  principal_id TEXT NOT NULL,
  principal_account TEXT NOT NULL,
  authorizer_address TEXT NOT NULL,
  authorizer_type TEXT NOT NULL CHECK (authorizer_type IN ('eip712','eip1271')),
  executor_address TEXT NOT NULL,
  authorization_nonce TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses = 1),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses BETWEEN 0 AND max_uses),
  status TEXT NOT NULL CHECK (status IN ('ACCEPTED','BOUND','REVOKED')),
  bound_tx_hash TEXT,
  authorization_json JSONB NOT NULL,
  acceptance_json JSONB NOT NULL,
  policy_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS authorizations_principal_idx ON authorizations(principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS authorizations_executor_idx ON authorizations(executor_address, created_at DESC);
