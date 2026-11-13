// Generated from evidence-r2.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
import { canonicalize, hashJson, sha256Hex } from "../../domain/hashing.mjs";
import { errorMessage } from "../../shared/error-code.mjs";
const ARCHIVE_CONTENT_TYPE = "application/json; charset=utf-8";
const ARCHIVE_OBJECT_VERSION = 1;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DEFAULT_STALE_AFTER_MS = 5 * 6e4;
const DEFAULT_LEASE_MS = 5 * 6e4;
const MAX_RECONCILE_BATCH = 100;
const failure = (code, message = code) => Object.assign(new Error(message), { code });
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const checksumHex = (value) => Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
function evidenceObjectKey({ projectId, environment, artifactHash }) {
  if (!IDENTIFIER.test(projectId) || !IDENTIFIER.test(environment) || !SHA256_HEX.test(artifactHash)) throw failure("ARCHIVE_HASH_MISMATCH", "Invalid evidence object scope or artifact hash");
  return `evidence/${projectId}/${environment}/sha256/${artifactHash}.json`;
}
function encodeEvidenceArtifact(artifact) {
  const canonical = canonicalize(artifact);
  const bytes = new TextEncoder().encode(canonical);
  return { bytes, artifactHash: sha256Hex(canonical), size: bytes.byteLength };
}
async function putVerifiedEvidenceObject(bucket, key, bytes, artifactHash, metadata) {
  try {
    await bucket.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: artifactHash,
      httpMetadata: { contentType: ARCHIVE_CONTENT_TYPE, cacheControl: "private, max-age=0" },
      customMetadata: { ...metadata, artifactHash, version: String(ARCHIVE_OBJECT_VERSION) }
    });
  } catch (error) {
    throw failure("ARCHIVE_STORAGE_UNAVAILABLE", errorMessage(error));
  }
  let head;
  try {
    head = await bucket.head(key);
  } catch (error) {
    throw failure("ARCHIVE_STORAGE_UNAVAILABLE", errorMessage(error));
  }
  if (!head) throw failure("ARCHIVE_WRITE_UNVERIFIED", "The R2 object is missing after a successful write");
  if (head.size !== bytes.byteLength) throw failure("ARCHIVE_WRITE_UNVERIFIED", "The R2 object size does not match the verified artifact");
  let checksum = head.checksums?.sha256 ? checksumHex(head.checksums.sha256) : null;
  if (!checksum) {
    const stored = await bucket.get(key);
    if (!stored) throw failure("ARCHIVE_WRITE_UNVERIFIED", "The R2 object disappeared before verification");
    checksum = sha256Bytes(new Uint8Array(await stored.arrayBuffer()));
  }
  if (checksum !== artifactHash) throw failure("ARCHIVE_WRITE_UNVERIFIED", "The R2 object content hash does not match the artifact hash");
  return { size: head.size, writtenAt: head.uploaded instanceof Date ? head.uploaded.getTime() : Date.now(), objectVersion: ARCHIVE_OBJECT_VERSION };
}
async function readVerifiedEvidenceObject(bucket, key, expected) {
  if (expected.objectVersion !== ARCHIVE_OBJECT_VERSION) throw failure("ARCHIVE_OBJECT_VERSION_UNSUPPORTED", "The R2 evidence object version is not supported");
  let object;
  try {
    object = await bucket.get(key);
  } catch (error) {
    throw failure("ARCHIVE_STORAGE_UNAVAILABLE", errorMessage(error));
  }
  if (!object) throw failure("ARCHIVE_OBJECT_MISSING", "The archive index exists but the R2 evidence object is missing");
  let buffer;
  try {
    buffer = await object.arrayBuffer();
  } catch (error) {
    throw failure("ARCHIVE_STORAGE_UNAVAILABLE", errorMessage(error));
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength !== expected.size) throw failure("ARCHIVE_INTEGRITY_FAILURE", "The R2 evidence object size does not match the D1 index");
  if (sha256Bytes(bytes) !== expected.artifactHash) throw failure("ARCHIVE_INTEGRITY_FAILURE", "The R2 evidence object hash does not match the D1 index");
  let artifact;
  try {
    artifact = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw failure("ARCHIVE_INTEGRITY_FAILURE", "The R2 evidence object is not valid JSON");
  }
  if (!record(artifact) || hashJson(artifact) !== expected.artifactHash) throw failure("ARCHIVE_INTEGRITY_FAILURE", "The R2 evidence object is not the verified canonical artifact");
  return artifact;
}
async function reconcileEvidenceArchiveOutbox({
  database,
  bucket,
  now = Date.now(),
  limit = 25,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  leaseMs = DEFAULT_LEASE_MS
}) {
  const batch = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_RECONCILE_BATCH) : 25;
  const staleBefore = now - Math.max(0, staleAfterMs);
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = now + Math.max(1, leaseMs);
  const claimed = await database.prepare(
    `UPDATE project_evidence_archive_outbox
       SET lease_token = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ?
     WHERE r2_key IN (
       SELECT r2_key FROM project_evidence_archive_outbox
        WHERE updated_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        ORDER BY updated_at ASC LIMIT ?
     )
     RETURNING r2_key, artifact_hash, size, object_version`
  ).bind(leaseToken, leaseExpiresAt, now, staleBefore, now, batch).all();
  const rows = claimed.results ?? [];
  const summary = { examined: rows.length, deletedObjects: 0, discardedIntents: 0, failed: 0 };
  for (const row of rows) {
    try {
      const indexed = await database.prepare(
        `SELECT 1 AS present FROM project_evidence_archive WHERE r2_key = ? AND artifact_hash = ? AND storage = 'r2'`
      ).bind(row.r2_key, row.artifact_hash).first();
      if (!indexed) {
        const object = await bucket.head(row.r2_key);
        if (object) {
          await bucket.delete(row.r2_key);
          summary.deletedObjects++;
        }
      }
      await database.prepare("DELETE FROM project_evidence_archive_outbox WHERE r2_key = ? AND lease_token = ?").bind(row.r2_key, leaseToken).run();
      if (!indexed) summary.discardedIntents++;
    } catch (error) {
      summary.failed++;
      await database.prepare(
        `UPDATE project_evidence_archive_outbox
           SET lease_token = NULL, lease_expires_at = NULL, updated_at = ?, last_error = ?
         WHERE r2_key = ? AND lease_token = ?`
      ).bind(now, errorMessage(error).slice(0, 512), row.r2_key, leaseToken).run().catch(() => void 0);
    }
  }
  return summary;
}
export {
  ARCHIVE_CONTENT_TYPE,
  ARCHIVE_OBJECT_VERSION,
  encodeEvidenceArtifact,
  evidenceObjectKey,
  putVerifiedEvidenceObject,
  readVerifiedEvidenceObject,
  reconcileEvidenceArchiveOutbox
};
