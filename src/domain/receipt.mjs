// Generated from receipt.mts by npm run core:build. Do not edit directly.
import { hashJson } from "./hashing.mjs";
import { classifyOutcome } from "./outcome.mjs";
import { bindIntentExecution } from "./binding.mjs";
import { signEd25519Statement, verifyEd25519Statement } from "./ed25519.mjs";
const RECEIPT_SCHEMA = "priorseal.execution-receipt.v1";
function buildReceipt({ intent, execution, issuer, keyId = "default", issuedAt = Math.floor(Date.now() / 1e3), verifierVersion = "1.0.0", reasonCodes = [] }) {
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) throw new TypeError("Receipt issuedAt must be a positive Unix timestamp");
  const observedAt = execution?.observedAt ?? execution?.executedAt;
  if (observedAt != null && (!Number.isSafeInteger(observedAt) || issuedAt < observedAt)) throw new TypeError("Receipt cannot be issued before the execution observation");
  const binding = bindIntentExecution(intent, execution, issuedAt);
  const executionHash = hashJson(execution);
  const unsigned = { schema: RECEIPT_SCHEMA, domain: "priorseal/execution-receipt/v1", receiptId: `psr_${hashJson({ intentHash: intent.intentHash, executionHash, issuer, keyId }).slice(0, 32)}`, intentHash: intent.intentHash, executionHash, execution, issuer, issuedAt, validUntil: intent.validUntil, outcome: classifyOutcome(intent, execution), reasonCodes: [.../* @__PURE__ */ new Set([...reasonCodes, ...binding.reasonCodes])], binding, algorithm: "Ed25519", keyId, verifierVersion };
  return unsigned;
}
function signReceipt(receipt, privateKeyPem) {
  return signEd25519Statement(receipt, privateKeyPem);
}
function verifySignature(receipt, publicKeyPem) {
  return verifyEd25519Statement(receipt, publicKeyPem);
}
export {
  RECEIPT_SCHEMA,
  buildReceipt,
  signReceipt,
  verifySignature
};
