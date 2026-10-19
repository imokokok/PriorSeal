-- Self-serve funding claims seed freshly provisioned accounts at zero credits
-- so that every granted credit is recorded through exactly one idempotent
-- credit operation. The positive seed requirement moves from the schema into
-- the operator issue flow, which already validates positive provisioned
-- credits. Follows the 0005 rebuild pattern: SQLite cannot alter a CHECK.
CREATE TABLE agent_meter_accounts_new (
  account_id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL UNIQUE,
  provisioned_credits INTEGER NOT NULL CHECK (provisioned_credits >= 0),
  remaining_credits INTEGER NOT NULL CHECK (remaining_credits >= 0),
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
INSERT INTO agent_meter_accounts_new (account_id, credential_hash, provisioned_credits, remaining_credits, status, updated_at)
  SELECT account_id, credential_hash, provisioned_credits, remaining_credits, status, updated_at FROM agent_meter_accounts;
DROP TABLE agent_meter_accounts;
ALTER TABLE agent_meter_accounts_new RENAME TO agent_meter_accounts;
