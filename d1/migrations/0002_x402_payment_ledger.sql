-- Existing D1 databases receive the immutable x402 payment/delivery ledger.
CREATE TABLE x402_payment_ledger_events (
  event_id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  payment_network TEXT NOT NULL,
  settlement_tx TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('PAYMENT_AUTHORIZED','RESOURCE_WITHHELD','SETTLEMENT_FAILED','SETTLEMENT_UNKNOWN','DELIVERED','REFUND_RECORDED')),
  occurred_at INTEGER NOT NULL,
  resource_hash TEXT,
  event_json TEXT NOT NULL
);
CREATE INDEX x402_payment_ledger_events_ledger_idx ON x402_payment_ledger_events(ledger_id, occurred_at, event_id);
CREATE INDEX x402_payment_ledger_events_settlement_idx ON x402_payment_ledger_events(payment_network, settlement_tx);
