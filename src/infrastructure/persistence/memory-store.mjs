import { hashJson } from '../../domain/hashing.mjs';

export function createMemoryStore({ clock = () => Date.now() } = {}) { const intents = new Map(), receipts = new Map(), observations = new Map(), idempotency = new Map(), jobs = new Map(), authorizations = new Map(), authorizationLog = []; return {
  async saveIntent(intent) { const existing = intents.get(intent.intentId); if (existing && existing.intentHash !== intent.intentHash) throw new Error('DUPLICATE_INTENT'); intents.set(intent.intentId, intent); return intent; },
  async getIntent(id) { return intents.get(id); }, async saveObservation(value) { const compound = `${value.chainId}:${value.txHash}`; const versions = observations.get(compound) ?? []; versions.push(value); observations.set(compound, versions); return value; },
  async getObservation(chainId, txHash) { return observations.get(`${chainId}:${txHash}`)?.at(-1); },
  async appendAuthorizationLog({ authorizationHash, acceptedAt }) { const existing = authorizationLog.find((entry) => entry.authorizationHash === authorizationHash); if (existing) return { ...existing }; const sequence = authorizationLog.length + 1; const previousEntryHash = authorizationLog.at(-1)?.entryHash ?? null; const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash }); const entry = { sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash }; authorizationLog.push(entry); return entry; },
  async listAuthorizationLog() { return authorizationLog.map((entry) => ({ ...entry })); },
  async saveAuthorization(record) { if (authorizations.has(record.authorization.authorizationId)) return authorizations.get(record.authorization.authorizationId); authorizations.set(record.authorization.authorizationId, structuredClone(record)); return structuredClone(record); },
  async getAuthorization(id) { const record = authorizations.get(id); return record && structuredClone(record); },
  async bindAuthorization(id, txHash) { const record = authorizations.get(id); if (!record) return { ok: false, code: 'AUTHORIZATION_NOT_FOUND' }; if (record.boundTxHash && record.boundTxHash !== txHash) return { ok: false, code: 'AUTHORIZATION_ALREADY_USED' }; if (!record.boundTxHash) { record.boundTxHash = txHash; record.uses = 1; record.status = 'BOUND'; } return { ok: true, record: structuredClone(record) }; },
  async saveReceipt(value) { if (!receipts.has(value.receiptId)) receipts.set(value.receiptId, value); return receipts.get(value.receiptId); }, async getReceipt(id) { return receipts.get(id); },
  async getIdempotency(scope, key) { return idempotency.get(`${scope}:${key}`); },
  async reserveIdempotency({ scope, key, requestHash, response, expiresAt }) {
    const compound = `${scope}:${key}`; const existing = idempotency.get(compound);
    if (existing && existing.expiresAt > clock()) {
      if (existing.requestHash !== requestHash) { const error = new Error('Idempotency key was reused with a different request'); error.code = 'IDEMPOTENCY_CONFLICT'; throw error; }
      return { replay: true, response: existing.response };
    }
    idempotency.set(compound, { requestHash, response, expiresAt }); return { replay: false, response };
  },
  async enqueueJob(job) {
    const existing = [...jobs.values()].find((candidate) => candidate.idempotencyKey === job.idempotencyKey && !['FAILED', 'COMPLETED'].includes(candidate.state));
    if (existing) return existing;
    jobs.set(job.jobId, { ...job }); return jobs.get(job.jobId);
  },
  async claimDueJobs(now, limit = 10) {
    const due = [...jobs.values()].filter((job) => ['QUEUED', 'RETRY_WAIT'].includes(job.state) && job.nextAttemptAt <= now).slice(0, limit);
    due.forEach((job) => { job.state = 'RUNNING'; job.attempts += 1; job.updatedAt = now; }); return due.map((job) => ({ ...job }));
  },
  async saveJob(job) { jobs.set(job.jobId, { ...job }); return jobs.get(job.jobId); },
  async getJob(jobId) { return jobs.get(jobId); },
  async listJobs() { return [...jobs.values()]; },
}; }
