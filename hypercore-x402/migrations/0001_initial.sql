CREATE TABLE IF NOT EXISTS hypercore_x402_payments (
  quote_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  network TEXT NOT NULL,
  amount TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  payer TEXT,
  payment_id TEXT,
  state TEXT NOT NULL,
  event TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE INDEX IF NOT EXISTS hypercore_x402_payments_payment_id_idx
  ON hypercore_x402_payments (payment_id);
CREATE INDEX IF NOT EXISTS hypercore_x402_payments_created_at_idx
  ON hypercore_x402_payments (created_at);
