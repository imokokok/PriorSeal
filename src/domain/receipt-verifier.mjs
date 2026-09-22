// Generated from receipt-verifier.mts by npm run core:build. Do not edit directly.
import { verifySignature } from "./receipt.mjs";
import { hashJson } from "./hashing.mjs";
import { assertOnlyFields, assertSafeJson } from "../shared/safe-json.mjs";
const RECEIPT_FIELDS = ["schema", "domain", "receiptId", "intentHash", "executionHash", "execution", "issuer", "issuedAt", "validUntil", "outcome", "reasonCodes", "binding", "algorithm", "keyId", "verifierVersion", "signature"];
function verifyReceipt(receipt, publicKeyPem, options = {}) {
  const candidate = receipt;
  const fail = (code) => ({ valid: false, code, outcome: candidate?.outcome, receiptId: candidate?.receiptId });
  try {
    assertSafeJson(receipt);
  } catch {
    return fail("INVALID_RECEIPT");
  }
  if (!candidate?.signature) return fail("MISSING_SIGNATURE");
  if (candidate.schema !== "priorseal.execution-receipt.v1") return fail("UNSUPPORTED_SCHEMA");
  if (candidate.algorithm !== "Ed25519") return fail("UNSUPPORTED_ALGORITHM");
  if (candidate.domain !== "priorseal/execution-receipt/v1") return fail("INVALID_DOMAIN");
  let checked;
  try {
    checked = assertOnlyFields(receipt, RECEIPT_FIELDS, "receipt");
  } catch {
    return fail("INVALID_RECEIPT");
  }
  if (options.keyId && checked.keyId !== options.keyId) return fail("UNKNOWN_KEY");
  if (options.key && options.key.keyId !== checked.keyId) return fail("UNKNOWN_KEY");
  if (options.key && (options.key.algorithm !== "Ed25519" || !["active", "retired"].includes(options.key.status) || options.key.issuer !== checked.issuer || !validKeyWindow(options.key))) return fail("INVALID_KEY");
  if (options.key?.validFrom != null && checked.issuedAt < options.key.validFrom) return fail("KEY_NOT_YET_VALID");
  if (options.key?.validUntil != null && checked.issuedAt > options.key.validUntil) return fail("KEY_EXPIRED");
  if (options.now !== void 0 && checked.issuedAt > options.now) return fail("NOT_YET_VALID");
  if (!Number.isSafeInteger(checked.issuedAt) || checked.issuedAt <= 0 || !Number.isSafeInteger(checked.validUntil) || checked.validUntil <= 0) return fail("INVALID_RECEIPT_TIMELINE");
  const execution = checked.execution;
  const observedAt = execution?.observedAt ?? execution?.executedAt;
  if (observedAt != null && (!Number.isSafeInteger(observedAt) || checked.issuedAt < observedAt)) return fail("INVALID_RECEIPT_TIMELINE");
  if (checked.executionHash !== hashJson(checked.execution)) return fail("EXECUTION_HASH_MISMATCH");
  const expectedReceiptId = `psr_${hashJson({ intentHash: checked.intentHash, executionHash: checked.executionHash, issuer: checked.issuer, keyId: checked.keyId }).slice(0, 32)}`;
  if (checked.receiptId !== expectedReceiptId) return fail("RECEIPT_ID_MISMATCH");
  return verifySignature(checked, publicKeyPem) ? { valid: true, code: "OK", outcome: checked.outcome, receiptId: checked.receiptId } : fail("INVALID_SIGNATURE");
}
function validKeyWindow(key) {
  for (const field of ["validFrom", "validUntil"]) {
    const value = key[field];
    if (value != null && (!Number.isSafeInteger(value) || value <= 0)) return false;
  }
  return key.validFrom == null || key.validUntil == null || key.validFrom <= key.validUntil;
}
export {
  verifyReceipt
};
