import { hashJson } from '../../domain/hashing.mjs';
import { archiveEntry, archivePage, type ArchiveAccess, type ArchiveQuery } from '../../application/archive/evidence-archive.mjs';
import { createMerkleProof, merkleAppendNodes, merkleNodeKey } from '../../domain/merkle-log.mjs';
import { assertReceiptIdentity } from './receipt-identity.mjs';
import type { Authorization, AuthorizationAcceptance } from '../../domain/authorization.mjs';
import type { ObservationJob, WorkerObservation } from '../../application/observations/observation-worker.mjs';
import type { buildIntent } from '../../domain/intent.mjs';

type Intent = ReturnType<typeof buildIntent>;
type LogEntry = { sequence: number; authorizationHash: string; acceptedAt: number; previousEntryHash: string | null; entryHash: string };
type AuthorizationRecord = { authorization: Authorization; acceptance: AuthorizationAcceptance; policy?: unknown; policyEvidence?: { schema: string; policyHash: string; result: unknown; document: Record<string, unknown> | null }; timestampEvidence?: unknown; witnessEvidence?: unknown; status: string; boundTxHash: string | null; uses: number };
type ArchiveEntry = ReturnType<typeof archiveEntry> & { sequence: number };
type Observation = WorkerObservation & { chainId: number | string };
type Receipt = Record<string, unknown> & { receiptId: string };
type IdempotencyRecord = { requestHash: string; response: unknown; expiresAt: number };
type MerkleAcceptance = Pick<AuthorizationAcceptance, 'sequence' | 'entryHash'>;

export function createMemoryStore({ clock = () => Date.now() } = {}) {
  const intents = new Map<string, Intent>(), receipts = new Map<string, Receipt>(), observations = new Map<string, Observation[]>(), idempotency = new Map<string, IdempotencyRecord>(), jobs = new Map<string, ObservationJob>(), authorizations = new Map<string, AuthorizationRecord>(), archive = new Map<string, ArchiveEntry>();
  const archiveEntries: ArchiveEntry[] = [], authorizationLog: LogEntry[] = [];
  const logByAuthorizationHash = new Map<string, LogEntry>(), merkleNodes = new Map<string, string>(), usedAuthorizationNonces = new Set<string>();

  function appendLogEntry(entry: LogEntry) {
    const nodes = merkleAppendNodes(entry.sequence, entry.entryHash, (start, level) => merkleNodes.get(merkleNodeKey(start, level)));
    authorizationLog.push(entry);
    logByAuthorizationHash.set(entry.authorizationHash, entry);
    for (const node of nodes) merkleNodes.set(merkleNodeKey(node.start, node.level), node.hash);
  }

  return {
  archiveRetention: 'process_lifetime',
  async saveArchiveEntry(entry: ReturnType<typeof archiveEntry>) {
    const key = JSON.stringify([entry.projectId, entry.environment, entry.id]);
    const existing = archive.get(key);
    if (existing) { if (existing.supersedesId !== entry.supersedesId) { const error: Error & { code?: string } = new Error('Archive entry already has a different supersession relationship'); error.code = 'ARCHIVE_CONFLICT'; throw error; } return structuredClone(existing); }
    if (entry.supersedesId && !archive.has(JSON.stringify([entry.projectId, entry.environment, entry.supersedesId]))) { const error: Error & { code?: string } = new Error('Superseded entry is not in this project'); error.code = 'NOT_FOUND'; throw error; }
    const saved = { ...structuredClone(entry), sequence: archiveEntries.length + 1 };
    archive.set(key, saved); archiveEntries.push(saved); return structuredClone(saved);
  },
  async getArchiveEntry(access: Pick<ArchiveAccess, 'projectId' | 'environment'>, id: string) { const entry = archive.get(JSON.stringify([access.projectId, access.environment, id])); return entry && structuredClone(entry); },
  async listArchiveEntries(query: ArchiveQuery) {
    const snapshot = query.cursor?.snapshot ?? archiveEntries.length;
    const highestSequence = Math.min(archiveEntries.length, snapshot, query.cursor ? query.cursor.after - 1 : snapshot);
    const rows: ArchiveEntry[] = [];
    // Sequence follows insertion order, so scan newest first and stop after the extra pagination row.
    for (let index = highestSequence - 1; index >= 0 && rows.length <= query.limit; index--) {
      const entry = archiveEntries[index];
      if (entry.projectId !== query.projectId || entry.environment !== query.environment ||
          (query.filters.txHash && entry.txHash !== query.filters.txHash) ||
          (query.filters.authorizationId && entry.authorizationId !== query.filters.authorizationId) ||
          (query.filters.status && entry.status !== query.filters.status) ||
          (query.filters.from !== null && entry.createdAt < query.filters.from) ||
          (query.filters.to !== null && entry.createdAt > query.filters.to)) continue;
      rows.push(entry);
    }
    return { ...archivePage(rows, query, snapshot), retention: 'process_lifetime' };
  },
  async saveIntent(intent: Intent) { const existing = intents.get(intent.intentId); if (existing && existing.intentHash !== intent.intentHash) throw new Error('DUPLICATE_INTENT'); intents.set(intent.intentId, intent); return intent; },
  async getIntent(id: string) { return intents.get(id); }, async saveObservation(value: Observation) { const compound = `${value.chainId}:${value.txHash}`; const versions = observations.get(compound) ?? []; versions.push(value); observations.set(compound, versions); return value; },
  async getObservation(chainId: number | string | undefined, txHash: string) { return observations.get(`${chainId}:${txHash}`)?.at(-1); },
  async appendAuthorizationLog({ authorizationHash, acceptedAt }: { authorizationHash: string; acceptedAt: number }) { const existing = logByAuthorizationHash.get(authorizationHash); if (existing) return { ...existing }; const sequence = authorizationLog.length + 1; const previousEntryHash = authorizationLog.at(-1)?.entryHash ?? null; const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash }); const entry = { sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash }; appendLogEntry(entry); return { ...entry }; },
  async listAuthorizationLog() { return authorizationLog.map((entry) => ({ ...entry })); },
  async getAuthorizationMerkleSnapshot(acceptance: MerkleAcceptance, size: number | null = null) {
    if (authorizationLog[acceptance.sequence - 1]?.entryHash !== acceptance.entryHash) throw new TypeError('Authorization acceptance does not match the local log');
    const checkpointSize = size ?? authorizationLog.length;
    if (!Number.isSafeInteger(checkpointSize) || checkpointSize < acceptance.sequence || checkpointSize > authorizationLog.length) throw new TypeError('Authorization is not present in the Merkle checkpoint');
    // Completed subtree hashes are immutable, including for historical checkpoint sizes.
    const { root, path } = createMerkleProof(acceptance.entryHash, acceptance.sequence, checkpointSize, merkleNodes);
    return { size: checkpointSize, headEntryHash: authorizationLog[checkpointSize - 1].entryHash, merkleRoot: root, proof: path };
  },
  async saveAcceptedAuthorization({ authorization, acceptedAt, createRecord }: { authorization: Authorization; acceptedAt: number; createRecord: (log: LogEntry) => AuthorizationRecord }) {
    const existing = authorizations.get(authorization.authorizationId); if (existing) return structuredClone(existing);
    if (usedAuthorizationNonces.has(authorization.authorizationNonce)) { const error: Error & { code?: string } = new Error('Authorization nonce has already been used'); error.code = 'AUTHORIZATION_NONCE_REUSED'; throw error; }
    const existingIntent = intents.get(authorization.intent.intentId); if (existingIntent && existingIntent.intentHash !== authorization.intentHash) throw new Error('DUPLICATE_INTENT');
    const authorizationHash = hashJson(authorization); const existingLog = logByAuthorizationHash.get(authorizationHash);
    const sequence = existingLog?.sequence ?? authorizationLog.length + 1; const previousEntryHash = existingLog?.previousEntryHash ?? authorizationLog.at(-1)?.entryHash ?? null;
    const log = existingLog ?? { sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash: hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash }) };
    const record = createRecord({ ...log }); const cloned = structuredClone(record);
    if (!existingLog) appendLogEntry(log); intents.set(authorization.intent.intentId, structuredClone(authorization.intent)); authorizations.set(authorization.authorizationId, cloned); usedAuthorizationNonces.add(authorization.authorizationNonce); return structuredClone(cloned);
  },
  async saveAuthorization(record: AuthorizationRecord) { if (authorizations.has(record.authorization.authorizationId)) return authorizations.get(record.authorization.authorizationId); if (usedAuthorizationNonces.has(record.authorization.authorizationNonce)) { const error: Error & { code?: string } = new Error('Authorization nonce has already been used'); error.code = 'AUTHORIZATION_NONCE_REUSED'; throw error; } authorizations.set(record.authorization.authorizationId, structuredClone(record)); usedAuthorizationNonces.add(record.authorization.authorizationNonce); return structuredClone(record); },
  async getAuthorization(id: string) { const record = authorizations.get(id); return record && structuredClone(record); },
  async bindAuthorization(id: string, txHash: string) { const record = authorizations.get(id); if (!record) return { ok: false, code: 'AUTHORIZATION_NOT_FOUND' }; if (record.boundTxHash && record.boundTxHash !== txHash) return { ok: false, code: 'AUTHORIZATION_ALREADY_USED' }; if (!record.boundTxHash) { record.boundTxHash = txHash; record.uses = 1; record.status = 'BOUND'; } return { ok: true, record: structuredClone(record) }; },
  async saveObservationReceipt({ authorizationId, claimAuthorization, observation, receipt }: { authorizationId?: string; claimAuthorization: boolean; observation: Observation; receipt: Receipt | null }) {
    const record = authorizationId ? authorizations.get(authorizationId) : null;
    assertReceiptIdentity(receipt ? receipts.get(receipt.receiptId) : undefined, receipt);
    if (claimAuthorization && !record) return { ok: false, code: 'AUTHORIZATION_NOT_FOUND' };
    if (claimAuthorization && record?.boundTxHash && record.boundTxHash !== observation.txHash) return { ok: false, code: 'AUTHORIZATION_ALREADY_USED' };
    const compound = `${observation.chainId}:${observation.txHash}`; const versions = observations.get(compound) ?? [];
    if (claimAuthorization && record && !record.boundTxHash) { record.boundTxHash = observation.txHash; record.uses = 1; record.status = 'BOUND'; }
    versions.push(structuredClone(observation)); observations.set(compound, versions);
    if (receipt && !receipts.has(receipt.receiptId)) receipts.set(receipt.receiptId, structuredClone(receipt));
    return { ok: true, record: record ? structuredClone(record) : null };
  },
  async saveReceipt(value: Receipt) { const existing = receipts.get(value.receiptId); assertReceiptIdentity(existing, value); if (!existing) receipts.set(value.receiptId, value); return receipts.get(value.receiptId); }, async getReceipt(id: string) { return receipts.get(id); },
  async getIdempotency<Response>(scope: string, key: string) { return idempotency.get(`${scope}:${key}`) as (IdempotencyRecord & { response: Response }) | undefined; },
  async reserveIdempotency<Response>({ scope, key, requestHash, response, expiresAt }: { scope: string; key: string; requestHash: string; response: Response; expiresAt: number }) {
    const compound = `${scope}:${key}`; const existing = idempotency.get(compound);
    if (existing && existing.expiresAt > clock()) {
      if (existing.requestHash !== requestHash) { const error: Error & { code?: string } = new Error('Idempotency key was reused with a different request'); error.code = 'IDEMPOTENCY_CONFLICT'; throw error; }
      return { replay: true, response: existing.response as Response };
    }
    idempotency.set(compound, { requestHash, response, expiresAt }); return { replay: false, response };
  },
  async enqueueJob(job: ObservationJob) {
    const existing = [...jobs.values()].find((candidate) => candidate.idempotencyKey === job.idempotencyKey && !['FAILED', 'COMPLETED'].includes(candidate.state));
    if (existing) return existing;
    const saved = { ...job }; jobs.set(job.jobId, saved); return saved;
  },
  async claimDueJobs(now: number, limit = 10) {
    const due = [...jobs.values()].filter((job) => ['QUEUED', 'RETRY_WAIT'].includes(job.state) && job.nextAttemptAt <= now).slice(0, limit);
    due.forEach((job) => { job.state = 'RUNNING'; job.attempts += 1; job.updatedAt = now; }); return due.map((job) => ({ ...job }));
  },
  async claimJob(jobId: string, now: number) {
    const job = jobs.get(jobId);
    if (!job || !['QUEUED', 'RETRY_WAIT'].includes(job.state) || job.nextAttemptAt > now) return undefined;
    job.state = 'RUNNING'; job.attempts += 1; job.updatedAt = now;
    return { ...job };
  },
  async saveJob(job: ObservationJob) { jobs.set(job.jobId, { ...job }); return jobs.get(job.jobId); },
  async getJob(jobId: string) { return jobs.get(jobId); },
  async listJobs() { return [...jobs.values()]; },
}; }
