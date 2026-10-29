-- This marker is applied only after D1 has applied migrations 0001 through
-- 0010. Worker startup can therefore make one indexed capability read instead
-- of repeatedly inspecting sqlite_master and table columns on every isolate.
--
-- When a future Worker requires new D1 structure, add a new migration that
-- advances this value in the same forward-only migration sequence, then update
-- the corresponding expected capability in cloudflare-schema.mts.
CREATE TABLE priorseal_schema_capabilities (
  capability TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0)
) WITHOUT ROWID;

INSERT INTO priorseal_schema_capabilities (capability, version)
VALUES ('cloudflare-runtime', 11);
