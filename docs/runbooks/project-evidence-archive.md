# Private uploaded-evidence archive

The optional archive stores artifacts explicitly uploaded by a project writer. It is separate from the existing public authorization, receipt, job and key-discovery APIs. Enabling it does **not** make those existing APIs private, import their history, or provide a complete record of all executions. Do not submit confidential evidence to a public deployment's normal issuance endpoints merely because its archive is private.

## Enable in a private environment

1. Apply `009_project_evidence_archive.sql` with the existing migration runner, first to an isolated development database. Production startup and readiness checks require its recorded migration when archive credentials are configured. Without credentials the archive endpoints return 404.
2. Generate a high-entropy bearer token for each project/environment/role through the operator's secret manager. Use at least 32 random bytes encoded as hex or base64url. Configure only its lowercase SHA-256 hex digest in `PRIORSEAL_ARCHIVE_CREDENTIALS_JSON`; deliver the original token to the authorized user through the same secret manager.
3. Use entries shaped as `{ "tokenHash": "<64 lowercase hex characters>", "projectId": "team-a", "environment": "production", "role": "writer" }`. A `reviewer` can list/read but cannot upload. Duplicate token hashes and malformed scope fields fail startup. Do not commit real credentials or hashes to the repository. For Workers, store this optional configuration as a deployment secret; it is deliberately not a required binding for existing public installations.
4. Verify writer upload, reviewer read-only access, cross-project denial, and retrieval from another device. Compare downloaded hashes and independently verify signatures. Upload success is not verification success.

The Node and Worker runtimes derive tenant scope solely from the bearer credential. Request bodies and query parameters cannot select another project. Responses, including errors, use `Cache-Control: private, no-store` and vary on authorization. Browser tokens remain only in page memory, are excluded from exports, and must be re-entered after navigation/reload.

## API and retention

- `POST /v1/archive` accepts `{ artifact, supersedesId? }`, where the artifact is a native verification bundle, review manifest, or accepted authorization record. The request body limit is 1 MiB by default. Indexed metadata is type-checked; the archive preserves the artifact without claiming to verify its signatures.
- `GET /v1/archive` accepts `limit` (1–100), `cursor`, `txHash`, `authorizationId`, `status`, and `from`/`to` (inclusive Unix seconds of archive creation). It returns metadata only. Cursors bind the project, environment and exact filters to an insertion snapshot, so concurrent uploads do not duplicate or displace entries on later pages.
- `GET /v1/archive/{id}` returns the original stored artifact and metadata within the authenticated scope. A known identifier from another project still returns 404.
- `GET /v1/archive/export` uses the same filters/cursors but includes each artifact in the page (default 10, maximum 25). Follow `nextCursor` without changing filters until it is null to export the entire matching insertion snapshot. Every page requires the project credential. Browser exports are bounded to 2,000 entries/20 MiB; cancellations, limits and request failures produce explicitly partial exports.

Entries are content-addressed within each project/environment. Re-uploading an identical artifact is idempotent. A differing supersession relationship for the same artifact is rejected; a successor must reference an existing entry in the same project. Reorg or revised evidence is a new artifact with `supersedesId`, leaving the old record available. This relationship is archive metadata, not an issuer-signed claim that the earlier evidence has been revoked.

Retention is explicitly `until_operator_deletion`. The service does not silently expire uploaded evidence and exposes no deletion endpoint. Establish and document the operator's retention and backup policy before hosting customer records. This is a minimal credential-scoped archive, without user accounts, SSO, automatic ingestion, complex RBAC, or billing entitlements.

Development without PostgreSQL uses memory storage and explicitly reports `process_lifetime`: it loses entries when the process restarts. Production configuration requires PostgreSQL. Do not use the in-memory adapter as a durable archive.

`NOT_VERIFIED_BY_ARCHIVE` is always preserved. An export proves neither completeness outside the named upload snapshot nor correctness of any uploaded statement. Use independently obtained keys, audience and the appropriate verifier profiles after downloading.

## Issuer-key rotation

Run `npm run rotation:impact -- <next-key-id>` with the operator's configured database. The command is read-only, reports unbound authorizations signed by other keys, their expiry, a total count, and up to 1,000 records with an explicit truncation flag. It does not print credentials, alter keys, reauthorize, or broadcast transactions. Expired does not mean no transaction was submitted.

Reconcile unknown submissions first and finish observations under the existing issuer key. Reauthorize only confirmed unexecuted actions. Current receipt/acceptance verification still requires the same issuer key; this change does not introduce cross-key evidence semantics. Browser rotation diagnostics cover only the supplied/local records and cannot claim to enumerate the server database.

## Local validation

`test/infrastructure/project-evidence-archive.test.mjs` applies the actual migration twice in an isolated PGlite PostgreSQL runtime and exercises immutable records, scoped foreign keys, filters and concurrent-upload pagination. HTTP tests check authentication, reviewer restrictions, cross-project denial and cache headers. These tests do not substitute for applying the migration to the target staging environment and checking its runtime role permissions.
