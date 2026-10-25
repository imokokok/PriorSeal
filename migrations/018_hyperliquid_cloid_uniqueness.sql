-- A cloid is the evidence reference for the HyperCore IOC profile. Reserve it
-- durably per account and network before an external client can submit it.
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS hyperliquid_network_ref TEXT;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS hyperliquid_account TEXT;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS hyperliquid_cloid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS authorizations_hyperliquid_cloid_unique_idx
  ON authorizations(hyperliquid_network_ref, hyperliquid_account, hyperliquid_cloid)
  WHERE hyperliquid_cloid IS NOT NULL;
