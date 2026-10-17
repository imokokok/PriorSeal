-- Idempotent credit operations are retained separately from usage so payment
-- callbacks and operator retries cannot double-credit an Agent account.
CREATE TABLE agent_meter_credit_operations (
  operation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES agent_meter_accounts(account_id),
  request_key TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  reference TEXT,
  credited_at INTEGER NOT NULL,
  UNIQUE(account_id, request_key)
);
CREATE INDEX agent_meter_credit_operations_account_idx ON agent_meter_credit_operations(account_id, credited_at DESC);
