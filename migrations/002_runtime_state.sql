-- Forward-only migration. Apply with a transactional migration runner; do not edit
-- previously applied migrations. See docs/runbooks/database.md for restore guidance.
ALTER TABLE intents ADD COLUMN IF NOT EXISTS intent_json JSONB;
UPDATE intents SET intent_json = jsonb_build_object('schema', schema_version, 'intentId', intent_id, 'intentHash', intent_hash, 'chainId', chain_id, 'action', action, 'sender', sender, 'recipient', recipient, 'asset', asset, 'amount', amount, 'nonce', nonce, 'validUntil', valid_until, 'constraints', constraints_json) WHERE intent_json IS NULL;
ALTER TABLE intents ALTER COLUMN intent_json SET NOT NULL;
ALTER TABLE execution_observations ADD COLUMN IF NOT EXISTS observation_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS execution_observation_version_idx ON execution_observations(chain_id, tx_hash, observation_hash);
CREATE TABLE IF NOT EXISTS idempotency_records (scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (scope, idempotency_key));
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_records(expires_at);
CREATE TABLE IF NOT EXISTS observation_jobs (job_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, input_json JSONB NOT NULL, state TEXT NOT NULL CHECK (state IN ('QUEUED','RUNNING','RETRY_WAIT','COMPLETED','UNDETERMINED','FAILED')), attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0), next_attempt_at TIMESTAMPTZ NOT NULL, observation_json JSONB, error_json JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS observation_jobs_due_idx ON observation_jobs(state, next_attempt_at) WHERE state IN ('QUEUED','RETRY_WAIT');
