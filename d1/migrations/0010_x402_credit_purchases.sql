-- The D1 counterpart to PostgreSQL migration 019. It contains only the
-- payment-ledger identifier and account binding, never raw payment payloads
-- or Agent credentials.
CREATE TABLE x402_credit_purchases (
  purchase_id TEXT PRIMARY KEY CHECK (purchase_id GLOB 'xcp_[0-9a-f]*' AND length(purchase_id) = 36),
  payment_ledger_id TEXT NOT NULL UNIQUE CHECK (payment_ledger_id GLOB 'xpl_[0-9a-f]*' AND length(payment_ledger_id) = 36),
  account_id TEXT NOT NULL REFERENCES agent_meter_accounts(account_id),
  pack_id TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  price_usd TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  authorized_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('AUTHORIZED','CREDITED')),
  settled_at INTEGER,
  settlement_network TEXT,
  settlement_transaction TEXT,
  CHECK ((state = 'AUTHORIZED' AND settled_at IS NULL AND settlement_network IS NULL AND settlement_transaction IS NULL) OR (state = 'CREDITED' AND settled_at IS NOT NULL AND settlement_network IS NOT NULL AND settlement_transaction IS NOT NULL))
);
CREATE INDEX x402_credit_purchases_account_idx ON x402_credit_purchases(account_id, authorized_at DESC);
