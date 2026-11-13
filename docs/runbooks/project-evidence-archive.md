# Private uploaded-evidence archive

The optional archive stores artifacts explicitly uploaded by a project writer. It is separate from the existing public authorization, receipt, job and key-discovery APIs. Enabling it does **not** make those existing APIs private, import their history, or provide a complete record of all executions. Do not submit confidential evidence to a public deployment's normal issuance endpoints merely because its archive is private.

## Storage split

D1 remains the authority for tenant scope, authorization state, receipt and Merkle metadata, idempotency records, observation jobs, archive ordering/supersession, and archive artifact hashes. Original artifact bytes are stored in D1 `entry_json` by default; R2 is an optional external store that is used only when the `EVIDENCE_BUCKET` binding is configured.

| Data | Authoritative store | Notes |
| --- | --- | --- |
| Authorization, acceptance, Merkle roots, receipts, idempotency, observation jobs | D1 | Unchanged |
| Archive entry identity, project/environment, sequence, supersession, artifact hash | D1 | `project_evidence_archive` |
| Original verification bundle / review manifest / archive artifact | D1 `entry_json` by default; R2 when `EVIDENCE_BUCKET` is configured | R2 key: `evidence/{project}/{environment}/sha256/{artifactHash}.json` |
| Future attachments and bulk export packages | R2 when configured; otherwise the D1 path | Same content-addressing rules; not implemented in this change |

R2 is storage, not an immutability proof. Immutability still comes from the canonical JSON hash, signatures, Merkle log, and external anchoring. R2 can be replaced or lost and the definitive claims do not change; what is lost is the convenience of retrieving the original artifact through this API.

## D1 schema and migration

Apply [`0012_evidence_archive_r2_index.sql`](../../d1/migrations/0012_evidence_archive_r2_index.sql) before deploying code that requires schema capability 12. It:

- adds `storage`, `r2_key`, `content_type`, `size`, `written_at`, and `object_version` to `project_evidence_archive`;
- creates a unique index on non-null `r2_key` and a storage/tenant/sequence index;
- creates `project_evidence_archive_outbox`, the write-ahead intent table used by reconciliation;
- advances `prorseal_schema_capabilities` for `cloudflare-runtime` to `12`.

Existing rows keep `storage='d1'` and their original `entry_json`, so historical artifacts remain readable without a data rewrite. New R2-backed rows keep the `NOT NULL` `entry_json` column satisfied with a small pointer document (`{"schema":"priorseal.archive-index-pointer.v1","r2Key":"..."}`). That pointer is not the artifact; reads of R2 rows never parse it.

Rollback is manual: [`d1/rollback/0012_evidence_archive_r2_index.sql`](../../d1/rollback/0012_evidence_archive_r2_index.sql). Before running it, stop archive writes and require:

```sql
SELECT COUNT(*) FROM project_evidence_archive WHERE storage = 'r2';
```

The result must be zero. R2-backed rows no longer contain the original artifact in `entry_json`; revert only after exporting those artifacts back into D1 with an operator who has R2 access. The rollback drops the outbox and new indexes and restores capability 11. It keeps the additive columns deliberately; old inserts still work because `storage` defaults to `d1`, and leaving inert columns avoids a risky SQLite table rebuild. R2 objects remain in the bucket but become unreachable through this API if their index rows are removed.

Do not run the migration against production as part of this change. This repository change was implemented and verified locally only.

## R2 provisioning and binding

R2 is not provisioned in this account yet, so `wrangler.jsonc` deliberately has no active R2 binding and production deployment is unchanged. After the account can create R2:

1. Create the bucket, for example `priorseal-evidence`.
2. Add the binding to the applicable environment in `wrangler.jsonc`:

```jsonc
"r2_buckets": [{ "binding": "EVIDENCE_BUCKET", "bucket_name": "priorseal-evidence" }]
```

3. Run `wrangler types` so `EVIDENCE_BUCKET` enters the generated `Env` type.
4. Apply D1 migration 0012 before deploying code that expects capability 12.
5. Keep archive credentials unset until both the binding and migration are ready.

The Worker treats the binding as optional. Without it, new archive writes keep the original D1 path: the canonical artifact hash is checked, the full entry is written to `entry_json`, and every read is hash-verified. An unconfigured deployment therefore behaves exactly as it did before R2 support existed. Only existing `storage='r2'` rows require the binding to read; those fail closed with `ARCHIVE_STORAGE_NOT_CONFIGURED` and are never resolved by scanning R2. Do not enable the binding without applying migration 0012 first.

## Write path and failure ordering

Without the binding, the write ends at the default D1 path: verify the artifact hash, insert `entry_json` with `ON CONFLICT DO NOTHING`, then read the row back through the same hash-verifying read path. No outbox row and no R2 object are involved.

With the binding configured, there is no shared transaction between D1 and R2. A new artifact follows this fixed order:

1. **Verify and hash before writing.** The artifact is canonicalized, its SHA-256 is computed, and the result must equal the entry `artifactHash`. A mismatch stops before R2.
2. **Write the D1 write-ahead intent.** The outbox row records the derived key, hash, size, content type, format version, timestamps, attempt count, and a short lease. This is a local D1 write; it does not contain the artifact.
3. **Conditional R2 write.** `bucket.put` uses `If-None-Match: *` and the SHA-256 checksum option. R2 only creates the object if the key is absent and only accepts a payload matching the supplied digest.
4. **Verify the stored object.** The Worker reads object metadata, checks size and the stored SHA-256 (falling back to a byte read if the checksum is absent), and compares it with the precomputed hash. Failure leaves no index row.
5. **Commit the D1 index.** One D1 batch inserts the index row and deletes the outbox row. Either both happen or neither happens.

The index is only committed after the object passed verification. A failed R2 write, failed verification, or failed D1 commit never produces an index row that readers can resolve to unverified bytes. An R2 success followed by a D1 failure leaves an outbox row and no index; the object is an orphan until reconciliation removes it.

## Read path and explicit failures

Every archive read verifies before returning artifact bytes:

- **Legacy D1 row** (`storage='d1'`): parse `entry_json`, recompute the canonical artifact hash, and require it to equal the index `artifact_hash`. A mismatch is `ARCHIVE_INTEGRITY_FAILURE`.
- **R2 row**: require the index fields, recompute the expected key from project/environment/hash, fetch only by that key, check size, check the SHA-256 of the bytes, parse JSON, and recheck the canonical hash. No listing or prefix search is used to discover the object.
- **Index missing**: return 404 for a specific identifier. The API never falls back to scanning R2.
- **Index present, object missing**: `ARCHIVE_OBJECT_MISSING` (HTTP 503).
- **Object bytes or size differ from the index**: `ARCHIVE_INTEGRITY_FAILURE` (HTTP 500). No artifact is returned.
- **Unsupported object format version**: `ARCHIVE_OBJECT_VERSION_UNSUPPORTED` (HTTP 409).

Metadata-only listing never reads R2. Export pages read and verify every object in the page; one missing or tampered object fails the page explicitly instead of returning a partial unverified page.

## Orphan reconciliation

The outbox is the durable source for reconciliation. A stale outbox row with no matching D1 index is the definition of an orphan:

- **Source**: `project_evidence_archive_outbox.r2_key`, written before the R2 conditional write and deleted in the same D1 batch as the index.
- **Judgment**: claim rows whose `updated_at` is older than the stale grace period and whose lease is absent or expired, then re-read `project_evidence_archive` for `r2_key`, `artifact_hash`, and `storage='r2'`. If the index exists, delete only the outbox row and keep the object. If the index is absent, `HEAD` the object, delete it (delete is idempotent), and delete the outbox row.
- **Idempotency**: a short lease prevents two scheduled runs from processing the same row; the index is re-read at cleanup time; content-addressed keys mean the same key always denotes the same verified bytes; `HEAD`/`DELETE` are idempotent. A late retry can rewrite the object and re-commit the index. If reconciliation deleted an object that a late writer then indexed, reads fail closed with `ARCHIVE_OBJECT_MISSING` rather than returning anything unverified.
- **Trigger**: the existing 15-minute Worker scheduled handler runs `reconcileEvidenceArchiveOutbox` after the schema-capability guard when `EVIDENCE_BUCKET` exists. It processes at most 100 rows per run (default 25) and failures are logged and retried on the next run.
- **Boundary**: this converges objects whose write went through the archive code. Objects written directly to the bucket out of band are not in the outbox; a periodic operator audit using an R2 listing against the D1 index is the correct future extension, not an automatic full-bucket scan.

## Free-tier budget and lifecycle

R2 free tier is 10 GB-month storage, 1 million Class A operations per month, and 10 million Class B operations per month. The archive currently spends one conditional PUT (Class A), one metadata verification (Class B), and ordinary D1 writes per successful upload attempt. Reads and export entries each spend Class B operations. Reconciliation spends HEAD requests and deletes.

Budget examples, before replication or other buckets:

- At an average 256 KiB artifact, 10 GB holds about 40,000 objects.
- At an average 1 MiB artifact, 10 GB holds about 10,000 objects.
- 1 million Class A operations covers many more uploads than 10 GB storage in both examples, so storage is the first limit.
- 10 million Class B operations per month allows roughly 10 million single-object reads or exports, but a 25-object export page counts 25 Class B operations.

Lifecycle guidance:

- Do **not** add an automatic expiry rule to the `evidence/` prefix while D1 retains the index. Expiring the object would turn a live index row into `ARCHIVE_OBJECT_MISSING`.
- Content-addressed keys are never overwritten, so a superseding artifact is a new object. Keep superseded objects while their index rows exist. If retention requires deleting old versions, delete or tombstone the D1 index row first in an audited workflow, then delete the R2 object; never the reverse.
- This change does not implement automatic retention deletion, bucket lifecycle rules, or storage-class transitions. Establish an operator review before approaching 8 GB (80%) and monitor Class A/Class B counters monthly.
- Keep a protected inventory using D1 `size` and `written_at` so storage growth can be projected from index rows without listing the bucket.

## API and retention

- `POST /v1/archive` accepts `{ artifact, supersedesId? }`, where the artifact is a native verification bundle, review manifest, or accepted authorization record. The request body limit is 1 MiB by default. Indexed metadata is type-checked; the archive preserves the artifact without claiming to verify its signatures.
- `GET /v1/archive` accepts `limit` (1–100), `cursor`, `txHash`, `authorizationId`, `status`, and `from`/`to` (inclusive Unix seconds of archive creation). It returns metadata only. Cursors bind the project, environment and exact filters to an insertion snapshot, so concurrent uploads do not duplicate or displace entries on later pages.
- `GET /v1/archive/{id}` returns the original stored artifact and metadata within the authenticated scope. A known identifier from another project still returns 404.
- `GET /v1/archive/export` uses the same filters/cursors but includes each artifact in the page (default 10, maximum 25). Follow `nextCursor` without changing filters until it is null to export the entire matching insertion snapshot. Every page requires the project credential. Browser exports are bounded to 2,000 entries/20 MiB; cancellations, limits and request failures produce explicitly partial exports.

Entries are content-addressed within each project/environment. Re-uploading an identical artifact is idempotent. A differing supersession relationship for the same artifact is rejected; a successor must reference an existing entry in the same project. Reorg or revised evidence is a new artifact with `supersedesId`, leaving the old record available. This relationship is archive metadata, not an issuer-signed claim that the earlier evidence has been revoked.

Retention is explicitly `until_operator_deletion`. The service does not silently expire uploaded evidence and exposes no deletion endpoint. Establish and document the operator's retention and backup policy before hosting customer records. This is a minimal credential-scoped archive, without user accounts, SSO, automatic ingestion, complex RBAC, or billing entitlements.

Development without durable storage uses memory and explicitly reports `process_lifetime`: it loses entries when the process restarts. Cloudflare production uses D1 for the index and R2 for artifact bytes; the separate Node path uses PostgreSQL and does not use R2. Do not use the in-memory adapter as a durable archive.

`NOT_VERIFIED_BY_ARCHIVE` is always preserved. An export proves neither completeness outside the named upload snapshot nor correctness of any uploaded statement. Use independently obtained keys, audience and the appropriate verifier profiles after downloading.

## Local validation and what still needs R2

`test/infrastructure/evidence-r2-archive.test.mjs` uses a real SQLite-backed D1 adapter and a fake R2 binding to cover:

- content-addressed key layout and index-only D1 rows;
- idempotent conditional writes and verified reads;
- missing index, missing object, oversized/mismatched bytes, and tampered legacy `entry_json`;
- export verification versus metadata-only listing;
- orphan creation after a simulated D1 batch failure, reconciliation, lease behavior, and repeat-run idempotency;
- rollback and capability restoration.

`test/infrastructure/project-evidence-archive.test.mjs` continues to cover the separate PostgreSQL path, which stores artifacts in PostgreSQL.

These tests validate the Worker logic, not Cloudflare R2 itself. Once the account is unblocked, verify in a disposable bucket:

1. `put` with `onlyIf.etagDoesNotMatch: '*'` returns `null` when the key exists.
2. The `sha256` put option rejects a deliberately mismatched payload.
3. `head` returns the expected `checksums.sha256` for the stored bytes.
4. Two concurrent writes to the same key produce one object and no unverified index.
5. A forced post-write D1 failure leaves a row in the outbox, and the scheduled reconciliation deletes the object and the row.
6. The optional binding is visible after `wrangler types`, and archive writes succeed only after migration 0012 and bucket creation.
7. Free-tier counters and lifecycle behavior match the assumptions above.

## Issuer-key rotation

Run `npm run rotation:impact -- <next-key-id>` with the operator's configured database. The command is read-only, reports unbound authorizations signed by other keys, their expiry, a total count, and up to 1,000 records with an explicit truncation flag. It does not print credentials, alter keys, reauthorize, or broadcast transactions. Expired does not mean no transaction was submitted.

Reconcile unknown submissions first and finish observations under the existing issuer key. Reauthorize only confirmed unexecuted actions. Current receipt/acceptance verification still requires the same issuer key; this change does not introduce cross-key evidence semantics. Browser rotation diagnostics cover only the supplied/local records and cannot claim to enumerate the server database.
