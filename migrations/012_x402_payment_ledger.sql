-- Immutable operational records for x402 verification, settlement and delivery.
-- Buyer payloads are intentionally excluded; event_json retains only its hash.
CREATE TABLE x402_payment_ledger_events (
  event_id TEXT PRIMARY KEY CHECK (event_id ~ '^xle_[0-9a-f]{32}$'),
  ledger_id TEXT NOT NULL CHECK (ledger_id ~ '^xpl_[0-9a-f]{32}$'),
  payment_network TEXT NOT NULL,
  settlement_tx TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('PAYMENT_AUTHORIZED','RESOURCE_WITHHELD','SETTLEMENT_FAILED','SETTLEMENT_UNKNOWN','DELIVERED','REFUND_RECORDED')),
  occurred_at BIGINT NOT NULL,
  resource_hash TEXT,
  event_json JSONB NOT NULL CHECK (jsonb_typeof(event_json) = 'object')
);
CREATE INDEX x402_payment_ledger_events_ledger_idx ON x402_payment_ledger_events(ledger_id, occurred_at, event_id);
CREATE INDEX x402_payment_ledger_events_settlement_idx ON x402_payment_ledger_events(payment_network, settlement_tx) WHERE settlement_tx IS NOT NULL;
