ALTER TABLE observation_jobs
  ADD COLUMN IF NOT EXISTS lease_token TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- Give work claimed by the pre-lease release a grace period to finish. A row
-- left behind by an interrupted old consumer becomes reclaimable afterwards.
UPDATE observation_jobs
SET lease_token = 'migration-008:' || job_id,
    lease_expires_at = now() + interval '15 minutes',
    updated_at = now()
WHERE state = 'RUNNING';

DROP INDEX IF EXISTS observation_jobs_due_idx;
CREATE INDEX IF NOT EXISTS observation_jobs_claim_idx
  ON observation_jobs(state, next_attempt_at, lease_expires_at)
  WHERE state IN ('QUEUED','RUNNING','RETRY_WAIT');
