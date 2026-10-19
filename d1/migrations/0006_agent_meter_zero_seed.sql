-- Self-serve funding claims seed freshly provisioned accounts at zero credits
-- so that every granted credit is recorded through exactly one idempotent
-- credit operation. The positive seed requirement moves from the schema into
-- the operator issue flow, which already validates positive provisioned
-- credits. SQLite cannot alter a CHECK, and D1 enforces foreign keys during
-- migrations, so the parent and both referencing children are rebuilt in
-- child-safe order (rename parent, recreate children, drop the renamed
-- parent last). No other tables reference the agent meter schema.
ALTER TABLE agent_meter_accounts RENAME TO agent_meter_accounts_old;
CREATE TABLE agent_meter_accounts (
  account_id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL UNIQUE,
  provisioned_credits INTEGER NOT NULL CHECK (provisioned_credits >= 0),
  remaining_credits INTEGER NOT NULL CHECK (remaining_credits >= 0),
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
INSERT INTO agent_meter_accounts (account_id, credential_hash, provisioned_credits, remaining_credits, status, updated_at)
  SELECT account_id, credential_hash, provisioned_credits, remaining_credits, status, updated_at FROM agent_meter_accounts_old;
CREATE TABLE agent_meter_usage_new (
  usage_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES agent_meter_accounts(account_id),
  route_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  reserved_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('RESERVED','CONSUMED','RELEASED')),
  UNIQUE(account_id, request_key)
);
INSERT INTO agent_meter_usage_new SELECT * FROM agent_meter_usage;
DROP TABLE agent_meter_usage;
ALTER TABLE agent_meter_usage_new RENAME TO agent_meter_usage;
CREATE INDEX agent_meter_usage_account_idx ON agent_meter_usage(account_id, reserved_at DESC);
CREATE TABLE agent_meter_credit_operations_new (
  operation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES agent_meter_accounts(account_id),
  request_key TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  reference TEXT,
  credited_at INTEGER NOT NULL,
  UNIQUE(account_id, request_key)
);
INSERT INTO agent_meter_credit_operations_new SELECT * FROM agent_meter_credit_operations;
DROP TABLE agent_meter_credit_operations;
ALTER TABLE agent_meter_credit_operations_new RENAME TO agent_meter_credit_operations;
CREATE INDEX agent_meter_credit_operations_account_idx ON agent_meter_credit_operations(account_id, credited_at DESC);
DROP TABLE agent_meter_accounts_old;
