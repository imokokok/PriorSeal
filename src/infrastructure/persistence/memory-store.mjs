// Generated from memory-store.mts by npm run core:build. Do not edit directly.
import { hashJson } from "../../domain/hashing.mjs";
import { archivePage } from "../../application/archive/evidence-archive.mjs";
import { createMerkleProof, merkleAppendNodes, merkleNodeKey } from "../../domain/merkle-log.mjs";
import { assertReceiptIdentity } from "./receipt-identity.mjs";
import { assertX402PaymentLedgerEvent } from "../../domain/x402-payment-ledger.mjs";
import { hyperliquidCloidReservation } from "../../domain/hyperliquid.mjs";
function paymentLedgerEventOrder(type) {
  return type === "PAYMENT_AUTHORIZED" ? 0 : type === "REFUND_RECORDED" ? 2 : 1;
}
function createMemoryStore({ clock = () => Date.now() } = {}) {
  const intents = /* @__PURE__ */ new Map(), receipts = /* @__PURE__ */ new Map(), observations = /* @__PURE__ */ new Map(), idempotency = /* @__PURE__ */ new Map(), jobs = /* @__PURE__ */ new Map(), authorizations = /* @__PURE__ */ new Map(), archive = /* @__PURE__ */ new Map();
  const archiveEntries = [], authorizationLog = [];
  const logByAuthorizationHash = /* @__PURE__ */ new Map(), merkleNodes = /* @__PURE__ */ new Map(), usedAuthorizationNonces = /* @__PURE__ */ new Set(), hyperliquidCloids = /* @__PURE__ */ new Map();
  const x402PaymentLedger = /* @__PURE__ */ new Map();
  const agentMeterAccounts = /* @__PURE__ */ new Map();
  const agentMeterUsage = /* @__PURE__ */ new Map();
  const agentMeterCreditOperations = /* @__PURE__ */ new Map();
  function appendLogEntry(entry) {
    const nodes = merkleAppendNodes(entry.sequence, entry.entryHash, (start, level) => merkleNodes.get(merkleNodeKey(start, level)));
    authorizationLog.push(entry);
    logByAuthorizationHash.set(entry.authorizationHash, entry);
    for (const node of nodes) merkleNodes.set(merkleNodeKey(node.start, node.level), node.hash);
  }
  return {
    archiveRetention: "process_lifetime",
    async health() {
      return "memory";
    },
    async appendX402PaymentLedgerEvent(value) {
      const event = assertX402PaymentLedgerEvent(value);
      const entries = x402PaymentLedger.get(event.ledgerId) ?? /* @__PURE__ */ new Map();
      x402PaymentLedger.set(event.ledgerId, entries);
      const existing = entries.get(event.eventId);
      if (existing) return structuredClone(existing);
      entries.set(event.eventId, structuredClone(event));
      return structuredClone(event);
    },
    async listX402PaymentLedgerEvents(ledgerId) {
      if (!/^xpl_[0-9a-f]{32}$/.test(ledgerId)) throw new TypeError("Invalid x402 payment ledger identifier");
      return [...x402PaymentLedger.get(ledgerId)?.values() ?? []].sort((left, right) => left.occurredAt - right.occurredAt || paymentLedgerEventOrder(left.type) - paymentLedgerEventOrder(right.type) || left.eventId.localeCompare(right.eventId)).map((value) => structuredClone(value));
    },
    async provisionAgentMeterAccount(input) {
      const provisionedCredits = BigInt(input.provisionedCredits);
      const existing = agentMeterAccounts.get(input.accountId);
      if (!existing) {
        agentMeterAccounts.set(input.accountId, { credentialHash: input.credentialHash, provisionedCredits, remainingCredits: provisionedCredits, status: input.status });
        return;
      }
      if (provisionedCredits > existing.provisionedCredits) existing.remainingCredits += provisionedCredits - existing.provisionedCredits;
      existing.provisionedCredits = provisionedCredits > existing.provisionedCredits ? provisionedCredits : existing.provisionedCredits;
    },
    async createAgentMeterAccount(input) {
      if (agentMeterAccounts.has(input.accountId)) return false;
      const provisionedCredits = BigInt(input.provisionedCredits);
      agentMeterAccounts.set(input.accountId, { credentialHash: input.credentialHash, provisionedCredits, remainingCredits: provisionedCredits, status: input.status });
      return true;
    },
    async findAgentMeterAccountByCredentialHash(credentialHash) {
      const found = [...agentMeterAccounts.entries()].find(([, account]) => account.credentialHash === credentialHash);
      return found ? { accountId: found[0], credentialHash: found[1].credentialHash, provisionedCredits: String(found[1].provisionedCredits), status: found[1].status } : null;
    },
    async getAgentMeterAccount(accountId) {
      const account = agentMeterAccounts.get(accountId);
      return account && { accountId, provisionedCredits: String(account.provisionedCredits), remainingCredits: String(account.remainingCredits), status: account.status };
    },
    async creditAgentMeterAccount(input) {
      const key = `${input.accountId}:${input.requestKey}`;
      const existing = agentMeterCreditOperations.get(key);
      if (existing) {
        if (existing.credits !== input.credits || existing.reference !== input.reference) throw Object.assign(new Error("Agent credit idempotency key was reused for a different operation"), { code: "IDEMPOTENCY_CONFLICT" });
        const account2 = agentMeterAccounts.get(input.accountId);
        return account2 && { replay: true, operation: structuredClone(existing), account: { accountId: input.accountId, provisionedCredits: String(account2.provisionedCredits), remainingCredits: String(account2.remainingCredits), status: account2.status } };
      }
      const account = agentMeterAccounts.get(input.accountId);
      if (!account) return null;
      const amount = BigInt(input.credits);
      account.provisionedCredits += amount;
      account.remainingCredits += amount;
      agentMeterCreditOperations.set(key, structuredClone(input));
      return { replay: false, operation: structuredClone(input), account: { accountId: input.accountId, provisionedCredits: String(account.provisionedCredits), remainingCredits: String(account.remainingCredits), status: account.status } };
    },
    async revokeAgentMeterAccount(accountId) {
      const account = agentMeterAccounts.get(accountId);
      if (!account) return null;
      account.status = "revoked";
      return { accountId, provisionedCredits: String(account.provisionedCredits), remainingCredits: String(account.remainingCredits), status: account.status };
    },
    async listAgentMeterUsage(accountId, limit) {
      return [...agentMeterUsage.values()].filter((entry) => entry.accountId === accountId).sort((left, right) => right.reservedAt - left.reservedAt || right.usageId.localeCompare(left.usageId)).slice(0, limit).map((value) => structuredClone(value));
    },
    async reserveAgentUsage(input) {
      const key = `${input.accountId}:${input.requestKey}`;
      const existing = agentMeterUsage.get(key);
      if (existing) {
        if (existing.routeId !== input.routeId || existing.credits !== input.credits) throw Object.assign(new Error("Agent request key was reused for a different metered route"), { code: "IDEMPOTENCY_CONFLICT" });
        return { kind: "replayed", reservation: structuredClone(existing) };
      }
      const account = agentMeterAccounts.get(input.accountId);
      const credits = BigInt(input.credits);
      if (!account || account.status !== "active" || account.remainingCredits < credits) return { kind: "insufficient" };
      account.remainingCredits -= credits;
      const reservation = { ...input, usageId: `amu_${hashJson({ accountId: input.accountId, requestKey: input.requestKey }).slice(0, 32)}`, state: "RESERVED" };
      agentMeterUsage.set(key, reservation);
      return { kind: "reserved", reservation: structuredClone(reservation) };
    },
    async settleAgentUsage(usageId, outcome) {
      const entry = [...agentMeterUsage.entries()].find(([, value]) => value.usageId === usageId);
      if (!entry) return null;
      const [key, reservation] = entry;
      if (reservation.state !== "RESERVED") return structuredClone(reservation);
      if (outcome === "RELEASED") {
        const account = agentMeterAccounts.get(reservation.accountId);
        if (!account) throw new Error("Metered account disappeared before credit release");
        account.remainingCredits += BigInt(reservation.credits);
      }
      const settled = { ...reservation, state: outcome };
      agentMeterUsage.set(key, settled);
      return structuredClone(settled);
    },
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
      const reservation = hyperliquidCloidReservation(authorization.intent);
      const reservationKey = reservation && `${reservation.networkRef}:${reservation.account}:${reservation.clientOrderId}`;
      if (reservationKey && hyperliquidCloids.has(reservationKey)) {
        const error = new Error("Hyperliquid client order id has already been authorized");
        error.code = "HYPERLIQUID_CLOID_ALREADY_AUTHORIZED";
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
      if (reservationKey) hyperliquidCloids.set(reservationKey, authorization.authorizationId);
      return structuredClone(cloned);
    },
    async saveAuthorization(record) {
      if (authorizations.has(record.authorization.authorizationId)) return authorizations.get(record.authorization.authorizationId);
      if (usedAuthorizationNonces.has(record.authorization.authorizationNonce)) {
        const error = new Error("Authorization nonce has already been used");
        error.code = "AUTHORIZATION_NONCE_REUSED";
        throw error;
      }
      const reservation = hyperliquidCloidReservation(record.authorization.intent);
      const reservationKey = reservation && `${reservation.networkRef}:${reservation.account}:${reservation.clientOrderId}`;
      if (reservationKey && hyperliquidCloids.has(reservationKey)) {
        const error = new Error("Hyperliquid client order id has already been authorized");
        error.code = "HYPERLIQUID_CLOID_ALREADY_AUTHORIZED";
        throw error;
      }
      authorizations.set(record.authorization.authorizationId, structuredClone(record));
      usedAuthorizationNonces.add(record.authorization.authorizationNonce);
      if (reservationKey) hyperliquidCloids.set(reservationKey, record.authorization.authorizationId);
      return structuredClone(record);
    },
    async getAuthorization(id) {
      const record = authorizations.get(id);
      return record && structuredClone(record);
    },
    async findHyperliquidCloidAuthorization(input) {
      return hyperliquidCloids.get(`${input.networkRef}:${input.account}:${input.clientOrderId}`) ?? null;
    },
    async claimAuthorization(id, txHash) {
      const record = authorizations.get(id);
      if (!record) return { ok: false, code: "AUTHORIZATION_NOT_FOUND" };
      if (record.boundTxHash || record.uses !== 0 || record.status !== "ACCEPTED") return { ok: false, code: "AUTHORIZATION_ALREADY_USED" };
      record.boundTxHash = txHash;
      record.uses = 1;
      record.status = "BOUND";
      return { ok: true, record: structuredClone(record) };
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
      const existing = [...jobs.values()].find((candidate) => candidate.idempotencyKey === job.idempotencyKey || candidate.coalesceKey === job.coalesceKey && ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(candidate.state));
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
export {
  createMemoryStore
};
