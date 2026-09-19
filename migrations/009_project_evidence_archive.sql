-- Private uploaded evidence is separate from public protocol lookup objects.
CREATE TABLE IF NOT EXISTS project_evidence_archive (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  project_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  tx_hash TEXT,
  authorization_id TEXT,
  status TEXT NOT NULL,
  supersedes_id TEXT,
  entry_json JSONB NOT NULL,
  PRIMARY KEY (project_id, environment, entry_id),
  FOREIGN KEY (project_id, environment, supersedes_id)
    REFERENCES project_evidence_archive(project_id, environment, entry_id)
);
CREATE INDEX IF NOT EXISTS project_archive_page_idx ON project_evidence_archive(project_id, environment, sequence DESC);
CREATE INDEX IF NOT EXISTS project_archive_tx_idx ON project_evidence_archive(project_id, environment, tx_hash, sequence DESC);
CREATE INDEX IF NOT EXISTS project_archive_authorization_idx ON project_evidence_archive(project_id, environment, authorization_id, sequence DESC);
