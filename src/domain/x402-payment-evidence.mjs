// Generated from x402-payment-evidence.mts by npm run core:build. Do not edit directly.
import { hashJson } from "./hashing.mjs";
import { signEd25519Statement, verifyEd25519Statement } from "./ed25519.mjs";
import { assertOnlyFields, assertSafeJson } from "../shared/safe-json.mjs";
const X402_PAYMENT_EVIDENCE_SCHEMA = "priorseal.x402-payment-evidence.v1";
const X402_PAYMENT_EVIDENCE_DOMAIN = "priorseal/x402-payment-evidence/v1";
function buildX402PaymentEvidence({ paymentPayload, requirement, settlement, service, issuer, keyId, issuedAt }) {
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) throw new TypeError("Payment evidence issuedAt must be a positive Unix timestamp");
  if (!issuer || !keyId) throw new TypeError("Payment evidence requires an issuer and keyId");
  if (!settlement.success || settlement.network !== requirement.network || !settlement.transaction) throw new TypeError("Payment evidence requires a successful matching settlement");
  if (!Number.isInteger(service.responseStatus) || service.responseStatus < 200 || service.responseStatus >= 300) throw new TypeError("Payment evidence requires a successful resource response");
  if (!/^https:\/\//.test(service.resourceUrl) || !/^[0-9a-f]{64}$/.test(service.responseHash)) throw new TypeError("Payment evidence service binding is invalid");
  const paymentPayloadHash = hashJson(paymentPayload);
  const payment = { paymentPayloadHash, requirement, settlement };
  const evidenceId = `psp_${hashJson({ payment, service, issuer, keyId }).slice(0, 32)}`;
  return {
    schema: X402_PAYMENT_EVIDENCE_SCHEMA,
    domain: X402_PAYMENT_EVIDENCE_DOMAIN,
    paymentEvidenceId: evidenceId,
    payment,
    service,
    issuer,
    keyId,
    issuedAt,
    algorithm: "Ed25519"
  };
}
function signX402PaymentEvidence(evidence, privateKeyPem) {
  return signEd25519Statement(evidence, privateKeyPem);
}
const EVIDENCE_FIELDS = ["schema", "domain", "paymentEvidenceId", "payment", "service", "issuer", "keyId", "issuedAt", "algorithm", "signature"];
function verifyX402PaymentEvidence(evidence, publicKeyPem, now) {
  const candidate = evidence;
  const fail = (code) => ({ valid: false, code, paymentEvidenceId: candidate?.paymentEvidenceId });
  try {
    assertSafeJson(evidence);
  } catch {
    return fail("INVALID_PAYMENT_EVIDENCE");
  }
  if (!candidate?.signature) return fail("MISSING_SIGNATURE");
  if (candidate.schema !== X402_PAYMENT_EVIDENCE_SCHEMA || candidate.domain !== X402_PAYMENT_EVIDENCE_DOMAIN || candidate.algorithm !== "Ed25519") return fail("UNSUPPORTED_SCHEMA");
  let checked;
  try {
    checked = assertOnlyFields(evidence, EVIDENCE_FIELDS, "x402 payment evidence");
  } catch {
    return fail("INVALID_PAYMENT_EVIDENCE");
  }
  if (typeof checked.issuer !== "string" || !checked.issuer || typeof checked.keyId !== "string" || !checked.keyId || !Number.isSafeInteger(checked.issuedAt) || checked.issuedAt <= 0) return fail("INVALID_PAYMENT_EVIDENCE");
  if (now !== void 0 && checked.issuedAt > now) return fail("NOT_YET_VALID");
  if (!isRecord(checked.payment) || !isRecord(checked.service)) return fail("INVALID_PAYMENT_EVIDENCE");
  const { payment, service } = checked;
  if (typeof payment.paymentPayloadHash !== "string" || !/^[0-9a-f]{64}$/.test(payment.paymentPayloadHash) || !isRecord(payment.requirement) || !isRecord(payment.settlement)) return fail("INVALID_PAYMENT_EVIDENCE");
  if (payment.settlement.success !== true || payment.settlement.network !== payment.requirement.network || typeof payment.settlement.transaction !== "string" || !payment.settlement.transaction) return fail("INVALID_PAYMENT_EVIDENCE");
  const responseStatus = service.responseStatus;
  if (typeof service.resourceUrl !== "string" || !/^https:\/\//.test(service.resourceUrl) || typeof responseStatus !== "number" || !Number.isInteger(responseStatus) || responseStatus < 200 || responseStatus >= 300 || typeof service.responseHash !== "string" || !/^[0-9a-f]{64}$/.test(service.responseHash)) return fail("INVALID_PAYMENT_EVIDENCE");
  const expectedId = `psp_${hashJson({ payment, service, issuer: checked.issuer, keyId: checked.keyId }).slice(0, 32)}`;
  if (checked.paymentEvidenceId !== expectedId) return fail("PAYMENT_EVIDENCE_ID_MISMATCH");
  return verifyEd25519Statement(checked, publicKeyPem) ? { valid: true, code: "OK", paymentEvidenceId: checked.paymentEvidenceId } : fail("INVALID_SIGNATURE");
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export {
  X402_PAYMENT_EVIDENCE_DOMAIN,
  X402_PAYMENT_EVIDENCE_SCHEMA,
  buildX402PaymentEvidence,
  signX402PaymentEvidence,
  verifyX402PaymentEvidence
};
