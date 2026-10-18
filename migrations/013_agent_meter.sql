CREATE TABLE agent_meter_accounts (
  account_id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL UNIQUE,
  provisioned_credits BIGINT NOT NULL CHECK (provisioned_credits > 0),
  remaining_credits BIGINT NOT NULL CHECK (remaining_credits >= 0),
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_meter_usage (
  usage_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES agent_meter_accounts(account_id),
  route_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  credits BIGINT NOT NULL CHECK (credits > 0),
  reserved_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('RESERVED','CONSUMED','RELEASED')),
  UNIQUE(account_id, request_key)
);
CREATE INDEX agent_meter_usage_account_idx ON agent_meter_usage(account_id, reserved_at DESC);
