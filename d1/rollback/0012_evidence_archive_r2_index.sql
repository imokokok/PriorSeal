-- Manual rollback for 0012_evidence_archive_r2_index.sql.
--
-- Preconditions:
--   1. Stop all archive writes before running this file.
--   2. Refuse to run while any row has storage='r2'. Those rows no longer hold
--      the original artifact in entry_json, so reverting the schema without
--      first exporting the R2 objects back into entry_json would leave the
--      entries readable only through the R2-aware code path.
--      Run this guard and require zero rows:
--        SELECT COUNT(*) FROM project_evidence_archive WHERE storage = 'r2';
--   3. Export/restore those artifacts with an operator who has R2 access before
--      continuing. This repository does not run that export automatically
--      because R2 is not provisioned and the operation needs production access.
--
-- The rollback restores the pre-0012 runtime capability and removes the
-- write-ahead outbox and the two new indexes. The additive columns are kept on
-- purpose: SQLite rebuilds are riskier than leaving inert columns, old inserts
-- still work because storage defaults to 'd1', and keeping the columns avoids
-- any chance of rewriting the existing archive table. Drop them later only with
-- a separately reviewed table rebuild.

DROP INDEX IF EXISTS project_evidence_outbox_reconcile_idx;
DROP TABLE IF EXISTS project_evidence_archive_outbox;
DROP INDEX IF EXISTS project_archive_storage_idx;
DROP INDEX IF EXISTS project_archive_r2_key_idx;

UPDATE priorseal_schema_capabilities SET version = 11 WHERE capability = 'cloudflare-runtime';
