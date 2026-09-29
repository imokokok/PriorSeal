// Generated from memory-store.mts by npm run core:build. Do not edit directly.
import { hashJson } from "../../domain/hashing.mjs";
import { archivePage } from "../../application/archive/evidence-archive.mjs";
import { createMerkleProof, merkleAppendNodes, merkleNodeKey } from "../../domain/merkle-log.mjs";
function createMemoryStore({ clock = () => Date.now() } = {}) {
  const intents = /* @__PURE__ */ new Map(), receipts = /* @__PURE__ */ new Map(), observations = /* @__PURE__ */ new Map(), idempotency = /* @__PURE__ */ new Map(), jobs = /* @__PURE__ */ new Map(), authorizations = /* @__PURE__ */ new Map(), archive = /* @__PURE__ */ new Map();
  const archiveEntries = [], authorizationLog = [];
  const logByAuthorizationHash = /* @__PURE__ */ new Map(), merkleNodes = /* @__PURE__ */ new Map(), usedAuthorizationNonces = /* @__PURE__ */ new Set();
  function appendLogEntry(entry) {
    const nodes = merkleAppendNodes(entry.sequence, entry.entryHash, (start, level) => merkleNodes.get(merkleNodeKey(start, level)));
    authorizationLog.push(entry);
    logByAuthorizationHash.set(entry.authorizationHash, entry);
    for (const node of nodes) merkleNodes.set(merkleNodeKey(node.start, node.level), node.hash);
  }
  return {
    archiveRetention: "process_lifetime",
    async saveArchiveEntry(entry) {
      const key = JSON.stringify([entry.projectId, entry.environment, entry.id]);
      const existing = archive.get(key);
      if (existing) {
        if (existing.supersedesId !== entry.supersedesId) {
          const error = new Error("Archive entry already has a different supersession relationship");
          error.code = "ARCHIVE_CONFLICT";
          throw error;
        }
        return structuredClone(existing);
      }
      if (entry.supersedesId && !archive.has(JSON.stringify([entry.projectId, entry.environment, entry.supersedesId]))) {
        const error = new Error("Superseded entry is not in this project");
        error.code = "NOT_FOUND";
        throw error;
      }
      const saved = { ...structuredClone(entry), sequence: archiveEntries.length + 1 };
      archive.set(key, saved);
      archiveEntries.push(saved);
      return structuredClone(saved);
    },
    async getArchiveEntry(access, id) {
      const entry = archive.get(JSON.stringify([access.projectId, access.environment, id]));
      return entry && structuredClone(entry);
    },
    async listArchiveEntries(query) {
      const snapshot = query.cursor?.snapshot ?? archiveEntries.length;
      const highestSequence = Math.min(archiveEntries.length, snapshot, query.cursor ? query.cursor.after - 1 : snapshot);
      const rows = [];
      for (let index = highestSequence - 1; index >= 0 && rows.length <= query.limit; index--) {
        const entry = archiveEntries[index];
        if (entry.projectId !== query.projectId || entry.environment !== query.environment || query.filters.txHash && entry.txHash !== query.filters.txHash || query.filters.authorizationId && entry.authorizationId !== query.filters.authorizationId || query.filters.status && entry.status !== query.filters.status || query.filters.from !== null && entry.createdAt < query.filters.from || query.filters.to !== null && entry.createdAt > query.filters.to) continue;
        rows.push(entry);
      }
      return { ...archivePage(rows, query, snapshot), retention: "process_lifetime" };
    },
    async saveIntent(intent) {
      const existing = intents.get(intent.intentId);
      if (existing && existing.intentHash !== intent.intentHash) throw new Error("DUPLICATE_INTENT");
      intents.set(intent.intentId, intent);
      return intent;
    },
    async getIntent(id) {
      return intents.get(id);
    },
    async saveObservation(value) {
      const compound = `${value.chainId}:${value.txHash}`;
      const versions = observations.get(compound) ?? [];
      versions.push(value);
      observations.set(compound, versions);
      return value;
    },
    async getObservation(chainId, txHash) {
      return observations.get(`${chainId}:${txHash}`)?.at(-1);
    },
    async appendAuthorizationLog({ authorizationHash, acceptedAt }) {
      const existing = logByAuthorizationHash.get(authorizationHash);
      if (existing) return { ...existing };
      const sequence = authorizationLog.length + 1;
      const previousEntryHash = authorizationLog.at(-1)?.entryHash ?? null;
      const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash });
      const entry = { sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash };
      appendLogEntry(entry);
      return { ...entry };
    },
    async listAuthorizationLog() {
      return authorizationLog.map((entry) => ({ ...entry }));
    },
    async getAuthorizationMerkleSnapshot(acceptance, size = null) {
      if (authorizationLog[acceptance.sequence - 1]?.entryHash !== acceptance.entryHash) throw new TypeError("Authorization acceptance does not match the local log");
      const checkpointSize = size ?? authorizationLog.length;
      if (!Number.isSafeInteger(checkpointSize) || checkpointSize < acceptance.sequence || checkpointSize > authorizationLog.length) throw new TypeError("Authorization is not present in the Merkle checkpoint");
      const { root, path } = createMerkleProof(acceptance.entryHash, acceptance.sequence, checkpointSize, merkleNodes);
      return { size: checkpointSize, headEntryHash: authorizationLog[checkpointSize - 1].entryHash, merkleRoot: root, proof: path };
    },
    async saveAcceptedAuthorization({ authorization, acceptedAt, createRecord }) {
      const existing = authorizations.get(authorization.authorizationId);
      if (existing) return structuredClone(existing);
      if (usedAuthorizationNonces.has(authorization.authorizationNonce)) {
        const error = new Error("Authorization nonce has already been used");
        error.code = "AUTHORIZATION_NONCE_REUSED";
        throw error;
      }
      const existingIntent = intents.get(authorization.intent.intentId);
      if (existingIntent && existingIntent.intentHash !== authorization.intentHash) throw new Error("DUPLICATE_INTENT");
      const authorizationHash = hashJson(authorization);
      const existingLog = logByAuthorizationHash.get(authorizationHash);
      const sequence = existingLog?.sequence ?? authorizationLog.length + 1;
      const previousEntryHash = existingLog?.previousEntryHash ?? authorizationLog.at(-1)?.entryHash ?? null;
      const log = existingLog ?? { sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash: hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash }) };
      const record = createRecord({ ...log });
      const cloned = structuredClone(record);
      if (!existingLog) appendLogEntry(log);
      intents.set(authorization.intent.intentId, structuredClone(authorization.intent));
      authorizations.set(authorization.authorizationId, cloned);
      usedAuthorizationNonces.add(authorization.authorizationNonce);
      return structuredClone(cloned);
    },
    async saveAuthorization(record) {
      if (authorizations.has(record.authorization.authorizationId)) return authorizations.get(record.authorization.authorizationId);
      if (usedAuthorizationNonces.has(record.authorization.authorizationNonce)) {
        const error = new Error("Authorization nonce has already been used");
        error.code = "AUTHORIZATION_NONCE_REUSED";
        throw error;
      }
      authorizations.set(record.authorization.authorizationId, structuredClone(record));
      usedAuthorizationNonces.add(record.authorization.authorizationNonce);
      return structuredClone(record);
    },
    async getAuthorization(id) {
      const record = authorizations.get(id);
      return record && structuredClone(record);
    },
    async bindAuthorization(id, txHash) {
      const record = authorizations.get(id);
      if (!record) return { ok: false, code: "AUTHORIZATION_NOT_FOUND" };
      if (record.boundTxHash && record.boundTxHash !== txHash) return { ok: false, code: "AUTHORIZATION_ALREADY_USED" };
      if (!record.boundTxHash) {
        record.boundTxHash = txHash;
        record.uses = 1;
        record.status = "BOUND";
      }
      return { ok: true, record: structuredClone(record) };
    },
    async saveObservationReceipt({ authorizationId, claimAuthorization, observation, receipt }) {
      const record = authorizationId ? authorizations.get(authorizationId) : null;
      assertReceiptIdentity(receipt ? receipts.get(receipt.receiptId) : void 0, receipt);
      if (claimAuthorization && !record) return { ok: false, code: "AUTHORIZATION_NOT_FOUND" };
      if (claimAuthorization && record?.boundTxHash && record.boundTxHash !== observation.txHash) return { ok: false, code: "AUTHORIZATION_ALREADY_USED" };
      const compound = `${observation.chainId}:${observation.txHash}`;
      const versions = observations.get(compound) ?? [];
      if (claimAuthorization && record && !record.boundTxHash) {
        record.boundTxHash = observation.txHash;
        record.uses = 1;
        record.status = "BOUND";
      }
      versions.push(structuredClone(observation));
      observations.set(compound, versions);
      if (receipt && !receipts.has(receipt.receiptId)) receipts.set(receipt.receiptId, structuredClone(receipt));
      return { ok: true, record: record ? structuredClone(record) : null };
    },
    async saveReceipt(value) {
      const existing = receipts.get(value.receiptId);
      assertReceiptIdentity(existing, value);
      if (!existing) receipts.set(value.receiptId, value);
      return receipts.get(value.receiptId);
    },
    async getReceipt(id) {
      return receipts.get(id);
    },
    async getIdempotency(scope, key) {
      return idempotency.get(`${scope}:${key}`);
    },
    async reserveIdempotency({ scope, key, requestHash, response, expiresAt }) {
      const compound = `${scope}:${key}`;
      const existing = idempotency.get(compound);
      if (existing && existing.expiresAt > clock()) {
        if (existing.requestHash !== requestHash) {
          const error = new Error("Idempotency key was reused with a different request");
          error.code = "IDEMPOTENCY_CONFLICT";
          throw error;
        }
        return { replay: true, response: existing.response };
      }
      idempotency.set(compound, { requestHash, response, expiresAt });
      return { replay: false, response };
    },
    async enqueueJob(job) {
      const existing = [...jobs.values()].find((candidate) => candidate.idempotencyKey === job.idempotencyKey && !["FAILED", "COMPLETED"].includes(candidate.state));
      if (existing) return existing;
      const saved = { ...job };
      jobs.set(job.jobId, saved);
      return saved;
    },
    async claimDueJobs(now, limit = 10) {
      const due = [...jobs.values()].filter((job) => ["QUEUED", "RETRY_WAIT"].includes(job.state) && job.nextAttemptAt <= now).slice(0, limit);
      due.forEach((job) => {
        job.state = "RUNNING";
        job.attempts += 1;
        job.updatedAt = now;
      });
      return due.map((job) => ({ ...job }));
    },
    async claimJob(jobId, now) {
      const job = jobs.get(jobId);
      if (!job || !["QUEUED", "RETRY_WAIT"].includes(job.state) || job.nextAttemptAt > now) return void 0;
      job.state = "RUNNING";
      job.attempts += 1;
      job.updatedAt = now;
      return { ...job };
    },
    async saveJob(job) {
      jobs.set(job.jobId, { ...job });
      return jobs.get(job.jobId);
    },
    async getJob(jobId) {
      return jobs.get(jobId);
    },
    async listJobs() {
      return [...jobs.values()];
    }
  };
}
function assertReceiptIdentity(existing, candidate) {
  if (!existing || !candidate || hashJson(existing) === hashJson(candidate)) return;
  const error = new Error("Receipt ID is already associated with different signed evidence");
  error.code = "RECEIPT_ID_CONFLICT";
  throw error;
}
export {
  createMemoryStore
};
