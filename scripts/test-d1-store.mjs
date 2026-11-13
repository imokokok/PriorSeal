// Generated from test-d1-store.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createD1Store } from "../src/infrastructure/persistence/d1-store.mjs";
import { archiveEntry } from "../src/application/archive/evidence-archive.mjs";
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON;");
sqlite.exec(readFileSync(new URL("../d1/migrations/0001_initial.sql", import.meta.url), "utf8"));
sqlite.exec(readFileSync(new URL("../d1/migrations/0008_observation_job_coalescing.sql", import.meta.url), "utf8"));
sqlite.exec(readFileSync(new URL("../d1/migrations/0009_hyperliquid_cloid_uniqueness.sql", import.meta.url), "utf8"));
sqlite.exec(readFileSync(new URL("../d1/migrations/0011_runtime_schema_capability.sql", import.meta.url), "utf8"));
sqlite.exec(readFileSync(new URL("../d1/migrations/0012_evidence_archive_r2_index.sql", import.meta.url), "utf8"));
const prepared = (sql, values = []) => ({
  bind: (...next) => prepared(sql, next),
  async first() {
    return sqlite.prepare(sql).get(...values) ?? null;
  },
  async all() {
    return { results: sqlite.prepare(sql).all(...values) };
  },
  async run() {
    const result = sqlite.prepare(sql).run(...values);
    return { results: [], meta: { changes: result.changes } };
  },
  execute() {
    const statement = sqlite.prepare(sql);
    return /^(SELECT|UPDATE.*RETURNING|INSERT.*RETURNING)/is.test(sql) ? { results: statement.all(...values) } : { results: [], meta: statement.run(...values) };
  }
});
const d1 = {
  prepare: (sql) => prepared(sql),
  async batch(statements) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
};
const sha256Bytes = (bytes) => {
  const digest = createHash("sha256").update(bytes).digest();
  return new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength).slice().buffer;
};
const r2Objects = /* @__PURE__ */ new Map();
const r2 = {
  async put(key, value, options) {
    if (options.onlyIf?.etagDoesNotMatch === "*" && r2Objects.has(key)) return null;
    const bytes = new Uint8Array(value);
    r2Objects.set(key, bytes);
    return { size: bytes.byteLength, checksums: { sha256: sha256Bytes(bytes) }, uploaded: /* @__PURE__ */ new Date(), version: "v1" };
  },
  async head(key) {
    const bytes = r2Objects.get(key);
    return bytes ? { size: bytes.byteLength, checksums: { sha256: sha256Bytes(bytes) }, uploaded: /* @__PURE__ */ new Date(), version: "v1" } : null;
  },
  async get(key) {
    const bytes = r2Objects.get(key);
    return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null;
  },
  async delete(key) {
    r2Objects.delete(key);
  }
};
const store = createD1Store(d1, { evidenceBucket: r2 });
const intent = { intentId: "test-intent", intentHash: "test-intent-hash", schema: "priorseal.intent.v1", chainId: 1, action: "TRANSFER", sender: "sender", recipient: "recipient", asset: "ETH", amount: "1", nonce: "n1", validUntil: 2e9 };
assert.equal((await store.saveIntent(intent)).intentId, intent.intentId);
assert.deepEqual(await store.getIntent(intent.intentId), intent);
assert.equal((await store.reserveIdempotency({ scope: "test", key: "key", requestHash: "hash", response: { ok: 1 }, expiresAt: Date.now() + 3e4 })).replay, false);
assert.equal((await store.reserveIdempotency({ scope: "test", key: "key", requestHash: "hash", response: { ok: 2 }, expiresAt: Date.now() + 3e4 })).replay, true);
const authorization = { authorizationId: "test-authorization", intentHash: intent.intentHash, intent, principal: { id: "principal", account: "account" }, authorizer: { address: "address", type: "eip712" }, delegate: { executor: "executor" }, authorizationNonce: "auth-nonce", expiresAt: 2e9, maxUses: 1 };
const accepted = await store.saveAcceptedAuthorization({ authorization, acceptedAt: 17e8, createRecord: (log) => ({ authorization, acceptance: { ...log }, policy: { allowed: true, reasonCodes: [], policyId: null }, status: "ACCEPTED", boundTxHash: null, uses: 0 }) });
assert.equal(accepted.acceptance.sequence, 1);
assert.equal((await store.getAuthorization(authorization.authorizationId)).acceptance.entryHash, accepted.acceptance.entryHash);
assert.equal((await store.getAuthorizationMerkleSnapshot(accepted.acceptance)).size, 1);
const observation = { intentHash: intent.intentHash, chainId: 1, txHash: "0x" + "a".repeat(64), status: "SUCCESS", blockNumber: 10, observedAt: 1700000010, finalityState: "FINAL" };
const receipt = { receiptId: "test-receipt", intentHash: intent.intentHash, execution: { txHash: observation.txHash }, schema: "test-receipt", issuer: "test", keyId: "test", outcome: "SUCCESS" };
assert.equal((await store.saveObservationReceipt({ authorizationId: authorization.authorizationId, claimAuthorization: true, observation, receipt })).ok, true);
assert.equal((await store.getAuthorization(authorization.authorizationId)).boundTxHash, observation.txHash);
assert.equal((await store.getReceipt(receipt.receiptId)).receiptId, receipt.receiptId);
assert.equal((await store.getObservation(1, observation.txHash)).status, "SUCCESS");
const job = { jobId: "job-1", idempotencyKey: "job-key", input: { chainId: 1, txHash: observation.txHash }, state: "QUEUED", attempts: 0, nextAttemptAt: Date.now() - 1e3, createdAt: Date.now(), observation: null, result: null, error: null };
await store.enqueueJob(job);
const [claimed] = await store.claimDueJobs(Date.now(), 1);
assert.ok(claimed);
assert.equal(claimed.state, "RUNNING");
assert.equal(claimed.attempts, 1);
assert.equal((await store.saveJob({ ...claimed, state: "COMPLETED", result: { observation } })).state, "COMPLETED");
assert.equal((await store.getJob(job.jobId)).state, "COMPLETED");
const entry = archiveEntry({ authorization: { schema: "priorseal.authorization.v2", authorizationId: authorization.authorizationId }, acceptance: { accepted: true }, status: "ACCEPTED" }, { projectId: "project", environment: "test", role: "reviewer" }, { now: 17e11 });
assert.equal((await store.saveArchiveEntry(entry)).id, entry.id);
const page = await store.listArchiveEntries({ projectId: "project", environment: "test", role: "reviewer", filters: { txHash: null, authorizationId: null, status: null, from: null, to: null }, filterHash: "test", cursor: null, limit: 10 });
assert.equal(page.items.length, 1);
assert.equal(page.items[0].artifact, void 0);
console.log("D1 adapter synthetic persistence test passed");
sqlite.close();
