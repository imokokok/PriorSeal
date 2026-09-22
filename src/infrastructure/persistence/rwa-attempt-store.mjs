// Generated from rwa-attempt-store.mts by npm run core:build. Do not edit directly.
import { errorCode } from "../../shared/error-code.mjs";
import { mkdir, open, readFile, rename, rmdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { hashJson } from "../../domain/hashing.mjs";
const empty = () => ({ schema: "priorseal.rwa-attempt-journal.v1", attempts: {}, nonces: {} });
const fail = (code) => {
  throw new Error(code);
};
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const uint = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const hash = (v) => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);
const time = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
function validTransaction(tx) {
  return object(tx) && Object.keys(tx).sort().join(",") === "chainId,data,from,nonce,to,value" && typeof tx.chainId === "number" && Number.isSafeInteger(tx.chainId) && tx.chainId > 0 && [tx.from, tx.to].every((v) => typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v)) && typeof tx.data === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(tx.data) && uint(tx.value) && uint(tx.nonce);
}
const nonceId = (tx) => hashJson({ chainId: tx.chainId, sender: tx.from, nonce: tx.nonce });
function createRwaAttemptStore({ directory }) {
  if (!isAbsolute(directory) || directory === "/") fail("RWA_STORE_DIRECTORY_REQUIRED");
  const path = join(directory, "journal.json"), lock = join(directory, "journal.lock");
  async function load() {
    try {
      const j = JSON.parse(await readFile(path, "utf8"));
      if (!object(j)) throw new Error("RWA_JOURNAL_INVALID");
      if (Object.keys(j).sort().join(",") !== "attempts,nonces,schema" || j.schema !== "priorseal.rwa-attempt-journal.v1" || !object(j.attempts) || !object(j.nonces)) fail("RWA_JOURNAL_INVALID");
      const attempts = j.attempts;
      const nonces = j.nonces;
      for (const [id, a] of Object.entries(attempts)) {
        if (!object(a) || Object.keys(a).sort().join(",") !== "authorizationId,executionDigest,nonceKey,status,transaction,txHash,updatedAt" || typeof a.authorizationId !== "string" || !/^auth_[0-9a-f]{32}$/.test(a.authorizationId) || hashJson(a.authorizationId) !== id || !validTransaction(a.transaction) || typeof a.nonceKey !== "string" || a.nonceKey !== nonceId(a.transaction) || nonces[a.nonceKey] !== id || !hash(a.executionDigest) || !time(a.updatedAt) || typeof a.status !== "string" || !["RESERVED", "SUBMITTING", "SUBMITTED", "UNCERTAIN", "REJECTED", "CONFIRMED", "REVERTED"].includes(a.status) || (["SUBMITTED", "CONFIRMED", "REVERTED"].includes(a.status) ? !hash(a.txHash) : a.txHash !== null)) fail("RWA_JOURNAL_INVALID");
      }
      if (Object.entries(nonces).some(([nonce, id]) => typeof id !== "string" || (object(attempts[id]) ? attempts[id].nonceKey : void 0) !== nonce)) fail("RWA_JOURNAL_INVALID");
      return j;
    } catch (e) {
      if (errorCode(e) === "ENOENT") return empty();
      throw e;
    }
  }
  async function commit(j) {
    const tmp = join(directory, "journal-" + randomUUID() + ".tmp");
    const file = await open(tmp, "wx", 384);
    try {
      await file.writeFile(JSON.stringify(j));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(tmp, path);
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  async function mutate(action) {
    await mkdir(directory, { recursive: true, mode: 448 });
    try {
      await mkdir(lock, { mode: 448 });
    } catch (e) {
      if (errorCode(e) === "EEXIST") fail("RWA_STORE_BUSY_OR_RECOVERY_REQUIRED");
      throw e;
    }
    let durable = false, persistStarted = false;
    try {
      const j = await load(), result = action(j);
      persistStarted = true;
      await commit(j);
      durable = true;
      return structuredClone(result);
    } finally {
      if (durable || !persistStarted) await rmdir(lock);
    }
  }
  return {
    async get(authorizationId) {
      return structuredClone((await load()).attempts[hashJson(authorizationId)] ?? null);
    },
    async reserve({ authorizationId, transaction, executionDigest, now }) {
      const tx = structuredClone(transaction), id = hashJson(authorizationId);
      if (!/^auth_[0-9a-f]{32}$/.test(authorizationId) || !hash(executionDigest) || !time(now)) fail("RWA_RESERVATION_INVALID");
      if (!validTransaction(tx)) throw new Error("RWA_RESERVATION_INVALID");
      const nonceKey = nonceId(tx);
      return mutate((j) => {
        if (j.attempts[id]) return { claimed: false, attempt: j.attempts[id] };
        if (j.nonces[nonceKey]) return { claimed: false, attempt: j.attempts[j.nonces[nonceKey]], code: "RWA_NONCE_ALREADY_RESERVED" };
        const attempt = { authorizationId, nonceKey, transaction: tx, executionDigest, status: "RESERVED", txHash: null, updatedAt: now };
        j.nonces[nonceKey] = id;
        j.attempts[id] = attempt;
        return { claimed: true, attempt };
      });
    },
    async transition(authorizationId, expected, patch) {
      const changes = structuredClone(patch);
      return mutate((j) => {
        const a = j.attempts[hashJson(authorizationId)];
        if (!a || !expected.includes(a.status)) fail("RWA_ATTEMPT_STATE_CONFLICT");
        if (!time(changes.updatedAt) || changes.updatedAt < a.updatedAt) fail("RWA_ATTEMPT_TIME_INVALID");
        const allowed = { RESERVED: ["SUBMITTING", "REJECTED"], SUBMITTING: ["SUBMITTED", "UNCERTAIN", "CONFIRMED", "REVERTED"], SUBMITTED: ["CONFIRMED", "REVERTED"], UNCERTAIN: ["CONFIRMED", "REVERTED"] };
        if (!allowed[a.status]?.includes(changes.status) || Object.keys(changes).some((k) => !["status", "txHash", "updatedAt"].includes(k))) fail("RWA_ATTEMPT_TRANSITION_INVALID");
        if (changes.txHash != null && !/^0x[0-9a-f]{64}$/.test(changes.txHash)) fail("RWA_TX_HASH_INVALID");
        if (["SUBMITTED", "CONFIRMED", "REVERTED"].includes(changes.status) && !hash(changes.txHash ?? a.txHash)) fail("RWA_TX_HASH_REQUIRED");
        if (["REJECTED", "SUBMITTING", "UNCERTAIN"].includes(changes.status) && changes.txHash != null) fail("RWA_TX_HASH_UNEXPECTED");
        if (a.txHash && changes.txHash && a.txHash !== changes.txHash) fail("RWA_TX_HASH_CONFLICT");
        Object.assign(a, changes);
        return a;
      });
    }
  };
}
export {
  createRwaAttemptStore
};
