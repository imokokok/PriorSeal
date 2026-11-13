-- D1 remains the authority for archive metadata, tenancy, ordering and
-- supersession. The original artifact bytes move to R2 and D1 stores only the
-- content-addressed index. Existing rows keep storage='d1' and their
-- entry_json, so historical artifacts remain readable without a rewrite.
ALTER TABLE project_evidence_archive ADD COLUMN storage TEXT NOT NULL DEFAULT 'd1' CHECK (storage IN ('d1', 'r2'));
ALTER TABLE project_evidence_archive ADD COLUMN r2_key TEXT;
ALTER TABLE project_evidence_archive ADD COLUMN content_type TEXT;
ALTER TABLE project_evidence_archive ADD COLUMN size INTEGER CHECK (size IS NULL OR size >= 0);
ALTER TABLE project_evidence_archive ADD COLUMN written_at INTEGER CHECK (written_at IS NULL OR written_at >= 0);
ALTER TABLE project_evidence_archive ADD COLUMN object_version INTEGER NOT NULL DEFAULT 1 CHECK (object_version > 0);

-- Content-addressed keys are unique. Legacy rows keep NULL and are excluded.
CREATE UNIQUE INDEX project_archive_r2_key_idx ON project_evidence_archive(r2_key) WHERE r2_key IS NOT NULL;
CREATE INDEX project_archive_storage_idx ON project_evidence_archive(storage, project_id, environment, sequence DESC);

-- Write-ahead intent. A row exists before the R2 conditional write starts and
-- is deleted in the same D1 batch that commits the index. If the process dies
-- after the R2 write but before the D1 batch, this row is the durable source
-- that lets scheduled reconciliation find and remove the orphan object.
CREATE TABLE project_evidence_archive_outbox (
  r2_key TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) = 64),
  size INTEGER NOT NULL CHECK (size >= 0),
  content_type TEXT NOT NULL,
  object_version INTEGER NOT NULL CHECK (object_version > 0),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_error TEXT,
  UNIQUE (project_id, environment, artifact_hash),
  CHECK (lease_token IS NULL OR lease_expires_at IS NOT NULL)
) WITHOUT ROWID;
CREATE INDEX project_evidence_outbox_reconcile_idx ON project_evidence_archive_outbox(updated_at, lease_expires_at);

UPDATE priorseal_schema_capabilities SET version = 12 WHERE capability = 'cloudflare-runtime';
