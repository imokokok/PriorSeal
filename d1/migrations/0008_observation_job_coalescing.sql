-- Collapse concurrently active observations for the same normalized request
-- while retaining the existing, durable idempotency-key history.
ALTER TABLE observation_jobs ADD COLUMN coalesce_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS observation_jobs_active_coalesce_key_idx
  ON observation_jobs(coalesce_key)
  WHERE coalesce_key IS NOT NULL AND state IN ('QUEUED','RUNNING','RETRY_WAIT');
