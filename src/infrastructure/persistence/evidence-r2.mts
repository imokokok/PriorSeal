import { createHash } from 'node:crypto';
import { canonicalize, hashJson, sha256Hex } from '../../domain/hashing.mjs';
import { errorMessage } from '../../shared/error-code.mjs';

export const ARCHIVE_CONTENT_TYPE = 'application/json; charset=utf-8';
export const ARCHIVE_OBJECT_VERSION = 1;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;
const DEFAULT_LEASE_MS = 5 * 60_000;
const MAX_RECONCILE_BATCH = 100;

export type EvidenceObjectScope = { projectId: string; environment: string; artifactHash: string };
export type EvidenceObjectWrite = { size: number; writtenAt: number; objectVersion: number };
export type EvidenceReconcileSummary = { examined: number; deletedObjects: number; discardedIntents: number; failed: number };

const failure = (code: string, message = code): Error & { code: string } => Object.assign(new Error(message), { code });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const checksumHex = (value: ArrayBuffer): string => Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Content-addressed key for the immutable evidence object. Scope values are
 * validated because the same identifiers become R2 key segments.
 */
export function evidenceObjectKey({ projectId, environment, artifactHash }: EvidenceObjectScope): string {
  if (!IDENTIFIER.test(projectId) || !IDENTIFIER.test(environment) || !SHA256_HEX.test(artifactHash)) throw failure('ARCHIVE_HASH_MISMATCH', 'Invalid evidence object scope or artifact hash');
  return `evidence/${projectId}/${environment}/sha256/${artifactHash}.json`;
}

export function encodeEvidenceArtifact(artifact: unknown) {
  const canonical = canonicalize(artifact);
  const bytes = new TextEncoder().encode(canonical);
  return { bytes, artifactHash: sha256Hex(canonical), size: bytes.byteLength };
}

/** R2's conditional write is the idempotency boundary; the read-back is the verification boundary. */
export async function putVerifiedEvidenceObject(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
  artifactHash: string,
  metadata: Record<string, string>,
): Promise<EvidenceObjectWrite> {
  try {
    await bucket.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: '*' },
      sha256: artifactHash,
      httpMetadata: { contentType: ARCHIVE_CONTENT_TYPE, cacheControl: 'private, max-age=0' },
      customMetadata: { ...metadata, artifactHash, version: String(ARCHIVE_OBJECT_VERSION) },
    });
  } catch (error) {
    throw failure('ARCHIVE_STORAGE_UNAVAILABLE', errorMessage(error));
  }
  let head: R2Object | null;
  try {
    head = await bucket.head(key);
  } catch (error) {
    throw failure('ARCHIVE_STORAGE_UNAVAILABLE', errorMessage(error));
  }
  if (!head) throw failure('ARCHIVE_WRITE_UNVERIFIED', 'The R2 object is missing after a successful write');
  if (head.size !== bytes.byteLength) throw failure('ARCHIVE_WRITE_UNVERIFIED', 'The R2 object size does not match the verified artifact');
  let checksum = head.checksums?.sha256 ? checksumHex(head.checksums.sha256) : null;
  if (!checksum) {
    const stored = await bucket.get(key);
    if (!stored) throw failure('ARCHIVE_WRITE_UNVERIFIED', 'The R2 object disappeared before verification');
    checksum = sha256Bytes(new Uint8Array(await stored.arrayBuffer()));
  }
  if (checksum !== artifactHash) throw failure('ARCHIVE_WRITE_UNVERIFIED', 'The R2 object content hash does not match the artifact hash');
  return { size: head.size, writtenAt: head.uploaded instanceof Date ? head.uploaded.getTime() : Date.now(), objectVersion: ARCHIVE_OBJECT_VERSION };
}

/**
 * Reads and verifies an object before any caller can return it. A missing
 * index is handled by the caller; this function never lists or searches R2.
 */
export async function readVerifiedEvidenceObject(
  bucket: R2Bucket,
  key: string,
  expected: { artifactHash: string; size: number; objectVersion: number },
): Promise<Record<string, unknown>> {
  if (expected.objectVersion !== ARCHIVE_OBJECT_VERSION) throw failure('ARCHIVE_OBJECT_VERSION_UNSUPPORTED', 'The R2 evidence object version is not supported');
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch (error) {
    throw failure('ARCHIVE_STORAGE_UNAVAILABLE', errorMessage(error));
  }
  if (!object) throw failure('ARCHIVE_OBJECT_MISSING', 'The archive index exists but the R2 evidence object is missing');
  let buffer: ArrayBuffer;
  try {
    buffer = await object.arrayBuffer();
  } catch (error) {
    throw failure('ARCHIVE_STORAGE_UNAVAILABLE', errorMessage(error));
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength !== expected.size) throw failure('ARCHIVE_INTEGRITY_FAILURE', 'The R2 evidence object size does not match the D1 index');
  if (sha256Bytes(bytes) !== expected.artifactHash) throw failure('ARCHIVE_INTEGRITY_FAILURE', 'The R2 evidence object hash does not match the D1 index');
  let artifact: unknown;
  try {
    artifact = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw failure('ARCHIVE_INTEGRITY_FAILURE', 'The R2 evidence object is not valid JSON');
  }
  if (!record(artifact) || hashJson(artifact) !== expected.artifactHash) throw failure('ARCHIVE_INTEGRITY_FAILURE', 'The R2 evidence object is not the verified canonical artifact');
  return artifact;
}

type OutboxRow = { r2_key: string; artifact_hash: string; size: number; object_version: number };

/**
 * Converges objects written to R2 whose D1 index commit never happened.
 *
 * Source of truth: the write-ahead outbox. An object is an orphan when a
 * stale outbox row has no matching D1 index row. The decision is re-read at
 * cleanup time, the row is leased so two schedulers cannot process it, and
 * head/delete are idempotent. A late retry can rewrite the object; if it
 * commits an index after cleanup, reads still verify the object hash and fail
 * closed instead of returning unverified bytes.
 */
export async function reconcileEvidenceArchiveOutbox({
  database,
  bucket,
  now = Date.now(),
  limit = 25,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  leaseMs = DEFAULT_LEASE_MS,
}: {
  database: D1Database;
  bucket: R2Bucket;
  now?: number;
  limit?: number;
  staleAfterMs?: number;
  leaseMs?: number;
}): Promise<EvidenceReconcileSummary> {
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
     RETURNING r2_key, artifact_hash, size, object_version`,
  ).bind(leaseToken, leaseExpiresAt, now, staleBefore, now, batch).all<OutboxRow>();
  const rows = claimed.results ?? [];
  const summary: EvidenceReconcileSummary = { examined: rows.length, deletedObjects: 0, discardedIntents: 0, failed: 0 };
  for (const row of rows) {
    try {
      const indexed = await database.prepare(
        `SELECT 1 AS present FROM project_evidence_archive WHERE r2_key = ? AND artifact_hash = ? AND storage = 'r2'`,
      ).bind(row.r2_key, row.artifact_hash).first<{ present: number }>();
      if (!indexed) {
        const object = await bucket.head(row.r2_key);
        if (object) {
          await bucket.delete(row.r2_key);
          summary.deletedObjects++;
        }
      }
      await database.prepare('DELETE FROM project_evidence_archive_outbox WHERE r2_key = ? AND lease_token = ?')
        .bind(row.r2_key, leaseToken).run();
      if (!indexed) summary.discardedIntents++;
    } catch (error) {
      summary.failed++;
      await database.prepare(
        `UPDATE project_evidence_archive_outbox
           SET lease_token = NULL, lease_expires_at = NULL, updated_at = ?, last_error = ?
         WHERE r2_key = ? AND lease_token = ?`,
      ).bind(now, errorMessage(error).slice(0, 512), row.r2_key, leaseToken).run().catch(() => undefined);
    }
  }
  return summary;
}
