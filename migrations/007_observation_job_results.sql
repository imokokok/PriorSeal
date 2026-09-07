ALTER TABLE observation_jobs
  ADD COLUMN IF NOT EXISTS result_json JSONB;
