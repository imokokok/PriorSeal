// Generated from rwa-attempt-model.mts by npm run core:build. Do not edit directly.
import { hashJson } from "../../domain/hashing.mjs";
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hash = (v) => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);
const time = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const uint = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
function assertRwaAuthorizationId(id) {
  if (typeof id !== "string" || !/^auth_[0-9a-f]{32}$/.test(id)) throw new Error("RWA_RESERVATION_INVALID");
}
function transaction(v) {
  return object(v) && Object.keys(v).sort().join(",") === "chainId,data,from,nonce,to,value" && typeof v.chainId === "number" && Number.isSafeInteger(v.chainId) && v.chainId > 0 && [v.from, v.to].every((a) => typeof a === "string" && /^0x[0-9a-f]{40}$/.test(a)) && typeof v.data === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(v.data) && uint(v.nonce) && uint(v.value);
}
function createRwaReservation(input) {
  const v = structuredClone(input);
  assertRwaAuthorizationId(v.authorizationId);
  if (!hash(v.executionDigest) || !time(v.now) || !transaction(v.transaction)) throw new Error("RWA_RESERVATION_INVALID");
  return {
    authorizationId: v.authorizationId,
    executionDigest: v.executionDigest,
    nonceKey: hashJson({ chainId: v.transaction.chainId, sender: v.transaction.from, nonce: v.transaction.nonce }),
    transaction: v.transaction,
    status: "RESERVED",
    txHash: null,
    updatedAt: v.now
  };
}
function persistedRwaAttempt(value, authorizationId, nonceKey) {
  if (!object(value) || Object.keys(value).sort().join(",") !== "authorizationId,executionDigest,nonceKey,status,transaction,txHash,updatedAt") throw new Error("RWA_JOURNAL_INVALID");
  const base = createRwaReservation({ authorizationId: value.authorizationId, transaction: value.transaction, executionDigest: value.executionDigest, now: value.updatedAt });
  if (base.authorizationId !== authorizationId || base.nonceKey !== nonceKey || value.nonceKey !== nonceKey || typeof value.status !== "string" || !["RESERVED", "SUBMITTING", "SUBMITTED", "UNCERTAIN", "REJECTED", "CONFIRMED", "REVERTED"].includes(value.status) || (["SUBMITTED", "CONFIRMED", "REVERTED"].includes(value.status) ? !hash(value.txHash) : value.txHash !== null)) throw new Error("RWA_JOURNAL_INVALID");
  return structuredClone(value);
}
function transitionRwaAttempt(attempt, expected, patch) {
  const changes = structuredClone(patch);
  if (!Array.isArray(expected) || !expected.includes(attempt.status)) throw new Error("RWA_ATTEMPT_STATE_CONFLICT");
  if (!time(changes.updatedAt) || changes.updatedAt < attempt.updatedAt) throw new Error("RWA_ATTEMPT_TIME_INVALID");
  const allowed = { RESERVED: ["SUBMITTING", "REJECTED"], SUBMITTING: ["SUBMITTED", "UNCERTAIN", "CONFIRMED", "REVERTED"], SUBMITTED: ["CONFIRMED", "REVERTED"], UNCERTAIN: ["CONFIRMED", "REVERTED"] };
  if (!allowed[attempt.status]?.includes(changes.status) || Object.keys(changes).some((k) => !["status", "txHash", "updatedAt"].includes(k))) throw new Error("RWA_ATTEMPT_TRANSITION_INVALID");
  if (changes.txHash != null && !hash(changes.txHash)) throw new Error("RWA_TX_HASH_INVALID");
  if (["SUBMITTED", "CONFIRMED", "REVERTED"].includes(changes.status) && !hash(changes.txHash ?? attempt.txHash)) throw new Error("RWA_TX_HASH_REQUIRED");
  if (["REJECTED", "SUBMITTING", "UNCERTAIN"].includes(changes.status) && changes.txHash != null) throw new Error("RWA_TX_HASH_UNEXPECTED");
  if (attempt.txHash && changes.txHash !== void 0 && attempt.txHash !== changes.txHash) throw new Error("RWA_TX_HASH_CONFLICT");
  return { ...attempt, ...changes };
}
export {
  assertRwaAuthorizationId,
  createRwaReservation,
  persistedRwaAttempt,
  transitionRwaAttempt
};
