import { createHash, timingSafeEqual } from 'node:crypto';
import { hashJson } from '../../domain/hashing.mjs';
import { PriorSealError } from '../../domain/errors.mjs';

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const ARCHIVE_SCOPE = 'uploaded_evidence';
export const ARCHIVE_RETENTION = 'until_operator_deletion';

/** Only hashed bearer credentials are configured. Never read tenancy from a request body. */
export function createArchiveAccess(entries) {
  if (entries === undefined || entries === null) return null;
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000) throw new TypeError('Archive access must contain 1-1000 credentials');
  const hashes = new Set();
  const credentials = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.tokenHash !== 'string' || typeof entry.projectId !== 'string' || typeof entry.environment !== 'string' || !/^[0-9a-f]{64}$/.test(entry.tokenHash) || hashes.has(entry.tokenHash) || !identifier.test(entry.projectId) || !identifier.test(entry.environment) || !['writer', 'reviewer'].includes(entry.role)) throw new TypeError('Invalid or duplicate archive credential');
    hashes.add(entry.tokenHash);
    return { tokenHash: entry.tokenHash, projectId: entry.projectId, environment: entry.environment, role: entry.role };
  });
  return {
    authenticate(header) {
      const token = typeof header === 'string' && /^Bearer [A-Za-z0-9._~-]{32,256}$/.test(header) ? header.slice(7) : '';
      const digest = createHash('sha256').update(token).digest();
      let access = null;
      for (const entry of credentials) if (timingSafeEqual(digest, Buffer.from(entry.tokenHash, 'hex'))) access = entry;
      if (!token || !access) throw new PriorSealError('ARCHIVE_UNAUTHORIZED', 'A valid project archive credential is required');
      return { projectId: access.projectId, environment: access.environment, role: access.role };
    },
  };
}

export function archiveEntry(artifact, access, { supersedesId = null, now = Date.now() } = {}) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) throw new PriorSealError('INVALID_REQUEST', 'An evidence artifact is required');
  let kind, receipt, authorization;
  if (artifact.schema === 'priorseal.verification-bundle.v1') { kind = 'verification-bundle'; receipt = artifact.receipt; }
  else if (artifact.schema === 'priorseal.review-manifest.v1') { kind = 'review-manifest'; receipt = artifact.bundle?.receipt; }
  else if (artifact.authorization?.schema === 'priorseal.authorization.v2' && artifact.acceptance) { kind = 'authorization'; authorization = artifact.authorization; }
  else throw new PriorSealError('INVALID_REQUEST', 'Upload a verification bundle, review manifest, or accepted authorization record');
  authorization ??= receipt?.authorizationEvidence?.authorization;
  if (kind !== 'authorization' && (!receipt?.receiptId || !receipt?.execution)) throw new PriorSealError('INVALID_REQUEST', 'The artifact does not contain a receipt');
  if (receipt && (typeof receipt.receiptId !== 'string' || !receipt.receiptId.trim() || receipt.receiptId.length > 256)) throw new PriorSealError('INVALID_REQUEST', 'Receipt ID must be a non-empty string of at most 256 characters');
  const txHash = receipt?.execution?.txHash ?? artifact.boundTxHash ?? null;
  if (txHash !== null && (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash))) throw new PriorSealError('INVALID_REQUEST', 'Archive transaction hash must be a 32-byte hex string');
  const authorizationId = authorization?.authorizationId ?? null;
  if (authorizationId !== null && (typeof authorizationId !== 'string' || !identifier.test(authorizationId))) throw new PriorSealError('INVALID_REQUEST', 'Archive authorization ID must be a valid identifier string');
  const status = receipt?.executionStatus ?? receipt?.execution?.status ?? artifact.status ?? 'ACCEPTED';
  if (typeof status !== 'string' || !identifier.test(status)) throw new PriorSealError('INVALID_REQUEST', 'Archive status must be a valid identifier string');
  if (supersedesId !== null && !/^[0-9a-f]{64}$/.test(supersedesId)) throw new PriorSealError('INVALID_REQUEST', 'Invalid superseded archive identifier');
  const artifactHash = hashJson(artifact);
  return {
    id: hashJson({ projectId: access.projectId, environment: access.environment, artifactHash }),
    projectId: access.projectId, environment: access.environment, kind,
    createdAt: Math.floor(now / 1000), artifactHash, supersedesId,
    txHash: txHash?.toLowerCase() ?? null,
    authorizationId,
    status,
    artifact,
    verification: 'NOT_VERIFIED_BY_ARCHIVE',
  };
}

export function archiveQuery(url, access) {
  const allowed = ['limit', 'cursor', 'txHash', 'authorizationId', 'status', 'from', 'to'];
  for (const [key] of url.searchParams) if (!allowed.includes(key) || url.searchParams.getAll(key).length > 1) throw new PriorSealError('INVALID_REQUEST', 'Invalid archive query field');
  const limit = Number(url.searchParams.get('limit') ?? 25);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new PriorSealError('INVALID_REQUEST', 'Archive limit must be between 1 and 100');
  const filters = { txHash: url.searchParams.get('txHash')?.toLowerCase() || null, authorizationId: url.searchParams.get('authorizationId') || null, status: url.searchParams.get('status') || null, from: null, to: null };
  if (filters.txHash && !/^0x[0-9a-f]{64}$/.test(filters.txHash)) throw new PriorSealError('INVALID_REQUEST', 'Invalid transaction hash');
  for (const key of ['authorizationId', 'status']) if (filters[key] && !identifier.test(filters[key])) throw new PriorSealError('INVALID_REQUEST', `Invalid ${key}`);
  for (const key of ['from', 'to']) if (url.searchParams.has(key)) { const value = Number(url.searchParams.get(key)); if (!Number.isSafeInteger(value) || value < 0) throw new PriorSealError('INVALID_REQUEST', 'Archive times must be Unix seconds'); filters[key] = value; }
  if (filters.from !== null && filters.to !== null && filters.from > filters.to) throw new PriorSealError('INVALID_REQUEST', 'Invalid archive time range');
  const filterHash = hashJson({ projectId: access.projectId, environment: access.environment, ...filters });
  let cursor = null;
  const encoded = url.searchParams.get('cursor');
  if (encoded) {
    try {
      if (encoded.length > 512) throw new Error('size');
      cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      if (cursor.filterHash !== filterHash || !Number.isSafeInteger(cursor.after) || cursor.after < 1 || !Number.isSafeInteger(cursor.snapshot) || cursor.snapshot < cursor.after) throw new Error('scope');
    } catch { throw new PriorSealError('INVALID_REQUEST', 'Invalid archive cursor or changed filters'); }
  }
  return { ...access, filters, filterHash, cursor, limit };
}

export function archivePage(rows, query, snapshot) {
  const more = rows.length > query.limit;
  const items = rows.slice(0, query.limit);
  return {
    schema: 'priorseal.archive-page.v1', projectId: query.projectId, environment: query.environment, role: query.role,
    items: items.map(({ artifact, sequence: _sequence, ...entry }) => ({ ...entry, ...(query.includeArtifacts ? { artifact } : {}) })),
    nextCursor: more ? Buffer.from(JSON.stringify({ after: items.at(-1).sequence, snapshot, filterHash: query.filterHash })).toString('base64url') : null,
    snapshot, filters: query.filters, scope: ARCHIVE_SCOPE, retention: ARCHIVE_RETENTION,
    completeness: 'All uploaded entries matching these filters up to the snapshot; not a claim about all executions.',
  };
}
