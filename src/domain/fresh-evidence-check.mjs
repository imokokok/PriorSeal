// Generated from fresh-evidence-check.mts by npm run core:build. Do not edit directly.
import { bindIntentExecution } from "./binding.mjs";
import { signEd25519Statement, verifyEd25519Statement } from "./ed25519.mjs";
import { hashJson } from "./hashing.mjs";
const FRESH_EVIDENCE_CHECK_SCHEMA = "priorseal.fresh-evidence-check.v1";
const FRESH_EVIDENCE_CHECK_DOMAIN = "priorseal/fresh-evidence-check/v1";
function assertString(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new TypeError(`Fresh evidence check ${field} is invalid`);
  return value;
}
function buildFreshEvidenceCheck({ receipt, authorization, currentExecution, issuer, keyId = "default", checkedAt = Math.floor(Date.now() / 1e3) }) {
  if (!Number.isSafeInteger(checkedAt) || checkedAt <= 0) throw new TypeError("Fresh evidence check checkedAt must be a positive Unix timestamp");
  const subject = {
    receiptId: assertString(receipt.receiptId, "receiptId"),
    issuer: assertString(receipt.issuer, "receipt issuer"),
    keyId: assertString(receipt.keyId, "receipt keyId"),
    executionHash: assertString(receipt.executionHash, "executionHash"),
    authorizationHash: assertString(receipt.authorizationHash, "authorizationHash")
  };
  const txHash = assertString(currentExecution.txHash, "transaction hash");
  const binding = bindIntentExecution(authorization.intent, currentExecution, checkedAt);
  const current = {
    chainId: currentExecution.chainId ?? authorization.intent.chainId,
    ...currentExecution.chainRef ? { chainRef: currentExecution.chainRef } : {},
    txHash,
    status: String(currentExecution.status ?? "UNKNOWN"),
    finalityState: String(currentExecution.finalityState ?? "UNKNOWN"),
    confirmations: Number(currentExecution.confirmations ?? 0),
    observedAt: currentExecution.observedAt ?? null,
    executedAt: currentExecution.executedAt ?? null,
    blockNumber: currentExecution.blockNumber ?? null,
    blockHash: currentExecution.blockHash ?? null,
    binding
  };
  const checkId = `psc_${hashJson({ subject, current, issuer, keyId, checkedAt }).slice(0, 32)}`;
  return {
    schema: FRESH_EVIDENCE_CHECK_SCHEMA,
    domain: FRESH_EVIDENCE_CHECK_DOMAIN,
    checkId,
    checkedAt,
    subject,
    receiptVerification: { valid: true, code: "OK" },
    current,
    limitations: [
      "A fresh check re-observes one already-recorded transaction; it does not authorize, submit, or custody an action.",
      "Independent reviewers should verify this signature using the published issuer key and evaluate their own RPC trust assumptions."
    ],
    issuer: assertString(issuer, "issuer"),
    keyId: assertString(keyId, "keyId"),
    algorithm: "Ed25519"
  };
}
function signFreshEvidenceCheck(check, privateKeyPem) {
  return signEd25519Statement(check, privateKeyPem);
}
function verifyFreshEvidenceCheck(value, publicKeyPem) {
  if (!value || value.schema !== FRESH_EVIDENCE_CHECK_SCHEMA || value.domain !== FRESH_EVIDENCE_CHECK_DOMAIN || value.algorithm !== "Ed25519") return false;
  return verifyEd25519Statement(value, publicKeyPem);
}
export {
  FRESH_EVIDENCE_CHECK_DOMAIN,
  FRESH_EVIDENCE_CHECK_SCHEMA,
  buildFreshEvidenceCheck,
  signFreshEvidenceCheck,
  verifyFreshEvidenceCheck
};
