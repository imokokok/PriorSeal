-- An x402 credit-pack checkout records the account binding before settlement
-- and atomically marks the resulting top-up after settlement. The table never
-- stores raw PAYMENT-SIGNATURE material or an Agent credential.
CREATE TABLE x402_credit_purchases (
  purchase_id TEXT PRIMARY KEY CHECK (purchase_id ~ '^xcp_[0-9a-f]{32}$'),
  payment_ledger_id TEXT NOT NULL UNIQUE CHECK (payment_ledger_id ~ '^xpl_[0-9a-f]{32}$'),
  account_id TEXT NOT NULL REFERENCES agent_meter_accounts(account_id),
  pack_id TEXT NOT NULL,
  credits BIGINT NOT NULL CHECK (credits > 0),
  price_usd TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('AUTHORIZED','CREDITED')),
  settled_at TIMESTAMPTZ,
  settlement_network TEXT,
  settlement_transaction TEXT,
  CHECK ((state = 'AUTHORIZED' AND settled_at IS NULL AND settlement_network IS NULL AND settlement_transaction IS NULL) OR (state = 'CREDITED' AND settled_at IS NOT NULL AND settlement_network IS NOT NULL AND settlement_transaction IS NOT NULL))
);
CREATE INDEX x402_credit_purchases_account_idx ON x402_credit_purchases(account_id, authorized_at DESC);
