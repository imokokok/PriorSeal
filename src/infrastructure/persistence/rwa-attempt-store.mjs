// Generated from rwa-attempt-store.mts by npm run core:build. Do not edit directly.
import { errorCode } from "../../shared/error-code.mjs";
import { mkdir, open, readFile, rename, rmdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { hashJson } from "../../domain/hashing.mjs";
import { assertRwaAttempt, createRwaReservation, transitionRwaAttempt } from "./rwa-attempt-model.mjs";
const empty = () => ({ schema: "priorseal.rwa-attempt-journal.v1", attempts: {}, nonces: {} });
const fail = (code) => {
  throw new Error(code);
};
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
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
        assertRwaAttempt(a);
        if (hashJson(a.authorizationId) !== id || nonces[a.nonceKey] !== id) fail("RWA_JOURNAL_INVALID");
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
      const attempt = createRwaReservation({ authorizationId, transaction, executionDigest, now });
      const id = hashJson(authorizationId), nonceKey = attempt.nonceKey;
      return mutate((j) => {
        if (j.attempts[id]) return { claimed: false, attempt: j.attempts[id] };
        if (j.nonces[nonceKey]) return { claimed: false, attempt: j.attempts[j.nonces[nonceKey]], code: "RWA_NONCE_ALREADY_RESERVED" };
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
        const next = transitionRwaAttempt(a, expected, changes);
        j.attempts[hashJson(authorizationId)] = next;
        return next;
      });
    }
  };
}
export {
  createRwaAttemptStore
};
