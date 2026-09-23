CREATE TABLE intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id TEXT NOT NULL UNIQUE,
  intent_hash TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  nonce TEXT NOT NULL,
  valid_until INTEGER NOT NULL,
  constraints_json TEXT,
  intent_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE execution_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_hash TEXT,
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  block_number INTEGER,
  observed_at INTEGER,
  finality_state TEXT,
  observation_json TEXT NOT NULL,
  observation_hash TEXT NOT NULL,
  outcome TEXT,
  reason_codes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (chain_id, tx_hash, observation_hash)
);
CREATE INDEX execution_chain_tx_idx ON execution_observations(chain_id, tx_hash, id DESC);

CREATE TABLE receipts (
  receipt_id TEXT PRIMARY KEY,
  intent_hash TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  schema TEXT NOT NULL,
  issuer TEXT NOT NULL,
  key_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  signature TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (scope, idempotency_key)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_records(expires_at);

CREATE TABLE observation_jobs (
  job_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  input_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED','RUNNING','RETRY_WAIT','COMPLETED','UNDETERMINED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  observation_json TEXT,
  result_json TEXT,
  error_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  lease_token TEXT,
  lease_expires_at INTEGER
);
CREATE INDEX observation_jobs_claim_idx ON observation_jobs(state, next_attempt_at, lease_expires_at);

CREATE TABLE authorization_log (
  sequence INTEGER PRIMARY KEY,
  authorization_hash TEXT NOT NULL UNIQUE,
  accepted_at INTEGER NOT NULL,
  previous_entry_hash TEXT,
  entry_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE authorization_log_merkle_nodes (
  start_sequence INTEGER NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 52),
  node_hash TEXT NOT NULL CHECK (length(node_hash) = 64),
  PRIMARY KEY (start_sequence, level)
);

CREATE TABLE authorizations (
  authorization_id TEXT PRIMARY KEY,
  authorization_hash TEXT NOT NULL UNIQUE,
  intent_hash TEXT NOT NULL REFERENCES intents(intent_hash),
  principal_id TEXT NOT NULL,
  principal_account TEXT NOT NULL,
  authorizer_address TEXT NOT NULL,
  authorizer_type TEXT NOT NULL CHECK (authorizer_type IN ('eip712','eip1271')),
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
CREATE INDEX authorizations_principal_idx ON authorizations(principal_id, created_at DESC);
CREATE INDEX authorizations_executor_idx ON authorizations(executor_address, created_at DESC);

CREATE TABLE project_evidence_archive (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  tx_hash TEXT,
  authorization_id TEXT,
  status TEXT NOT NULL,
  supersedes_id TEXT,
  entry_json TEXT NOT NULL,
  UNIQUE (project_id, environment, entry_id),
  FOREIGN KEY (project_id, environment, supersedes_id)
    REFERENCES project_evidence_archive(project_id, environment, entry_id)
);
CREATE INDEX project_archive_page_idx ON project_evidence_archive(project_id, environment, sequence DESC);
CREATE INDEX project_archive_tx_idx ON project_evidence_archive(project_id, environment, tx_hash, sequence DESC);
CREATE INDEX project_archive_authorization_idx ON project_evidence_archive(project_id, environment, authorization_id, sequence DESC);

CREATE TABLE witness_attestations (
  request_hash TEXT NOT NULL,
  witness_id TEXT NOT NULL,
  authorization_hash TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  attestation_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (request_hash, witness_id)
);
CREATE INDEX witness_attestations_authorization_idx ON witness_attestations(authorization_hash, observed_at);
