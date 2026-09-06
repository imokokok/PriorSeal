ALTER TABLE authorizations
  ADD COLUMN IF NOT EXISTS timestamp_evidence_json JSONB;
