-- Immutable operational evidence for fee-bearing guarded 0x Solana relays.
-- A RELAY_SUBMITTED event means the relay returned the expected signature; it
-- is not a statement that the swap or fee settled on-chain.
CREATE TABLE zeroex_commercial_ledger_events (
  event_id TEXT PRIMARY KEY CHECK (event_id ~ '^zce_[0-9a-f]{32}$'),
  ledger_id TEXT NOT NULL CHECK (ledger_id ~ '^zcl_[0-9a-f]{32}$'),
  tenant_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  transaction_signature TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('RELAY_ATTEMPTED','RELAY_NOT_CLAIMED','RELAY_SUBMITTED','RELAY_UNKNOWN')),
  occurred_at BIGINT NOT NULL,
  fee_profile_id TEXT NOT NULL,
  fee_mint TEXT NOT NULL,
  fee_ppm INTEGER NOT NULL CHECK (fee_ppm BETWEEN 1 AND 100000),
  recipient_token_account TEXT NOT NULL,
  expected_fee_atomic TEXT NOT NULL CHECK (expected_fee_atomic ~ '^[1-9][0-9]*$'),
  event_json JSONB NOT NULL CHECK (jsonb_typeof(event_json) = 'object')
);
CREATE INDEX zeroex_commercial_ledger_events_ledger_idx ON zeroex_commercial_ledger_events(ledger_id, occurred_at, event_id);
CREATE INDEX zeroex_commercial_ledger_events_reconciliation_idx ON zeroex_commercial_ledger_events(tenant_id, occurred_at DESC, event_id DESC);
CREATE INDEX zeroex_commercial_ledger_events_signature_idx ON zeroex_commercial_ledger_events(transaction_signature);
