// Generated from x402-payment-ledger.mts by npm run core:build. Do not edit directly.
import { hashJson } from "./hashing.mjs";
import { assertSafeJson } from "../shared/safe-json.mjs";
import { decodeBase58, SOLANA_MAINNET_CAIP2 } from "./solana.mjs";
const X402_PAYMENT_LEDGER_SCHEMA = "priorseal.x402-payment-ledger.v1";
function x402PaymentLedgerId(context, resourceUrl) {
  assertResourceUrl(resourceUrl);
  return `xpl_${hashJson({ paymentPayloadHash: hashJson(context.payload), requirement: context.requirement, resourceUrl }).slice(0, 32)}`;
}
function buildX402PaymentLedgerEvent(input) {
  const { type, context, resourceUrl, occurredAt, responseStatus, responseBody, settlement, settlementAttempts, paymentEvidenceId } = input;
  if (!["PAYMENT_AUTHORIZED", "RESOURCE_WITHHELD", "SETTLEMENT_FAILED", "SETTLEMENT_UNKNOWN", "DELIVERED"].includes(type)) throw new TypeError("Unsupported x402 payment ledger event type");
  assertSafeJson(context.payload);
  assertRequirement(context.requirement);
  assertResourceUrl(resourceUrl);
  assertOccurredAt(occurredAt);
  if (responseStatus !== void 0 && (!Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599)) throw new TypeError("Invalid x402 payment ledger response status");
  if (settlement !== void 0) assertSettlement(settlement, context.requirement.network);
  if (settlementAttempts !== void 0 && (!Number.isSafeInteger(settlementAttempts) || settlementAttempts < 1 || settlementAttempts > 2)) throw new TypeError("Invalid x402 payment ledger settlement attempt count");
  if (paymentEvidenceId !== void 0 && !/^psp_[0-9a-f]{32}$/.test(paymentEvidenceId)) throw new TypeError("Invalid x402 payment evidence identifier");
  assertEventConsistency({ type, responseStatus, responseBody, settlement, settlementAttempts, paymentEvidenceId });
  const paymentPayloadHash = hashJson(context.payload);
  const resource = {
    url: resourceUrl,
    ...responseStatus === void 0 ? {} : { responseStatus },
    ...responseBody === void 0 ? {} : { responseHash: hashJson(responseBody) }
  };
  const unsigned = {
    schema: X402_PAYMENT_LEDGER_SCHEMA,
    ledgerId: `xpl_${hashJson({ paymentPayloadHash, requirement: context.requirement, resourceUrl }).slice(0, 32)}`,
    type,
    occurredAt,
    paymentPayloadHash,
    requirement: context.requirement,
    resource,
    ...settlement === void 0 ? {} : { settlement },
    ...settlementAttempts === void 0 ? {} : { settlementAttempts },
    ...paymentEvidenceId === void 0 ? {} : { paymentEvidenceId }
  };
  return { ...unsigned, eventId: `xle_${hashJson(unsigned).slice(0, 32)}` };
}
function buildX402PaymentRefundLedgerEvent({ ledgerId, network, transaction, amount, reasonCode, occurredAt }) {
  if (!/^xpl_[0-9a-f]{32}$/.test(ledgerId) || !/^\d+$/.test(amount) || BigInt(amount) < 1n || !/^[A-Za-z0-9_.-]{1,128}$/.test(reasonCode)) throw new TypeError("Invalid x402 refund ledger event");
  assertSettlementTransaction(network, transaction, "refund");
  assertOccurredAt(occurredAt);
  const unsigned = { schema: X402_PAYMENT_LEDGER_SCHEMA, ledgerId, type: "REFUND_RECORDED", occurredAt, refund: { network, transaction, amount, reasonCode } };
  return { ...unsigned, eventId: `xle_${hashJson(unsigned).slice(0, 32)}` };
}
function assertX402PaymentLedgerEvent(value) {
  assertSafeJson(value);
  if (!record(value) || value.schema !== X402_PAYMENT_LEDGER_SCHEMA || typeof value.eventId !== "string" || !/^xle_[0-9a-f]{32}$/.test(value.eventId) || typeof value.ledgerId !== "string" || !/^xpl_[0-9a-f]{32}$/.test(value.ledgerId) || typeof value.type !== "string" || !["PAYMENT_AUTHORIZED", "RESOURCE_WITHHELD", "SETTLEMENT_FAILED", "SETTLEMENT_UNKNOWN", "DELIVERED", "REFUND_RECORDED"].includes(value.type)) throw new TypeError("Invalid persisted x402 payment ledger event");
  assertOccurredAt(value.occurredAt);
  if (value.type === "REFUND_RECORDED") {
    if (!record(value.refund) || typeof value.refund.network !== "string" || typeof value.refund.transaction !== "string" || typeof value.refund.amount !== "string" || typeof value.refund.reasonCode !== "string") throw new TypeError("Invalid persisted x402 refund ledger event");
    if (!/^\d+$/.test(value.refund.amount) || BigInt(value.refund.amount) < 1n || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.refund.reasonCode)) throw new TypeError("Invalid persisted x402 refund ledger event");
    assertSettlementTransaction(value.refund.network, value.refund.transaction, "refund");
    return value;
  }
  if (typeof value.paymentPayloadHash !== "string" || !/^[0-9a-f]{64}$/.test(value.paymentPayloadHash) || !record(value.requirement) || !record(value.resource)) throw new TypeError("Invalid persisted x402 payment ledger event");
  assertRequirement(value.requirement);
  assertResourceUrl(value.resource.url);
  const responseStatus = value.resource.responseStatus;
  if (responseStatus !== void 0 && (typeof responseStatus !== "number" || !Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599)) throw new TypeError("Invalid persisted x402 payment ledger response status");
  const responseHash = value.resource.responseHash;
  if (responseHash !== void 0 && (typeof responseHash !== "string" || !/^[0-9a-f]{64}$/.test(responseHash))) throw new TypeError("Invalid persisted x402 payment ledger response hash");
  if (value.settlement !== void 0) assertSettlement(value.settlement, value.requirement.network);
  const settlementAttempts = value.settlementAttempts;
  if (settlementAttempts !== void 0 && (typeof settlementAttempts !== "number" || !Number.isSafeInteger(settlementAttempts) || settlementAttempts < 1 || settlementAttempts > 2)) throw new TypeError("Invalid persisted x402 payment ledger settlement attempt count");
  if (value.paymentEvidenceId !== void 0 && (typeof value.paymentEvidenceId !== "string" || !/^psp_[0-9a-f]{32}$/.test(value.paymentEvidenceId))) throw new TypeError("Invalid persisted x402 payment evidence identifier");
  assertEventConsistency({ type: value.type, responseStatus, responseBody: responseHash === void 0 ? void 0 : {}, settlement: value.settlement, settlementAttempts, paymentEvidenceId: value.paymentEvidenceId });
  return value;
}
function assertRequirement(value) {
  if (!record(value) || value.scheme !== "exact" || typeof value.network !== "string" || typeof value.amount !== "string" || !/^\d+$/.test(value.amount) || typeof value.asset !== "string" || typeof value.payTo !== "string" || !Number.isSafeInteger(value.maxTimeoutSeconds) || value.maxTimeoutSeconds < 1 || !record(value.extra) || !Object.values(value.extra).every((entry) => typeof entry === "string")) throw new TypeError("Invalid x402 payment ledger requirement");
}
function assertSettlement(value, network) {
  if (!record(value) || typeof value.success !== "boolean" || value.network !== network || typeof value.transaction !== "string" || value.errorReason !== void 0 && typeof value.errorReason !== "string" || value.payer !== void 0 && typeof value.payer !== "string" || value.amount !== void 0 && !/^\d+$/.test(value.amount)) throw new TypeError("Invalid x402 payment ledger settlement");
  if (value.transaction) assertSettlementTransaction(network, value.transaction, "settlement");
}
function assertEventConsistency({ type, responseStatus, responseBody, settlement, settlementAttempts, paymentEvidenceId }) {
  if (type === "PAYMENT_AUTHORIZED" && (responseStatus !== void 0 || responseBody !== void 0 || settlement !== void 0 || settlementAttempts !== void 0 || paymentEvidenceId !== void 0)) throw new TypeError("Invalid payment-authorized ledger event");
  if (type === "RESOURCE_WITHHELD" && (responseStatus === void 0 || responseStatus >= 200 && responseStatus < 300 || settlement !== void 0 || settlementAttempts !== void 0 || paymentEvidenceId !== void 0)) throw new TypeError("Invalid resource-withheld ledger event");
  if (type === "SETTLEMENT_FAILED" && (!settlement || settlement.success || responseStatus === void 0 || responseStatus < 200 || responseStatus >= 300 || settlementAttempts === void 0 || paymentEvidenceId !== void 0)) throw new TypeError("Invalid settlement-failed ledger event");
  if (type === "SETTLEMENT_UNKNOWN" && (settlement !== void 0 || responseStatus === void 0 || responseStatus < 200 || responseStatus >= 300 || settlementAttempts !== void 0 || paymentEvidenceId !== void 0)) throw new TypeError("Invalid settlement-unknown ledger event");
  if (type === "DELIVERED" && (!settlement?.success || responseStatus === void 0 || responseStatus < 200 || responseStatus >= 300 || responseBody === void 0 || settlementAttempts === void 0)) throw new TypeError("Invalid delivered ledger event");
}
function assertSettlementTransaction(network, transaction, label) {
  if (/^eip155:[1-9]\d*$/.test(network) && /^0x[0-9a-fA-F]{64}$/.test(transaction)) return;
  if (network === SOLANA_MAINNET_CAIP2) {
    try {
      if (decodeBase58(transaction).length === 64) return;
    } catch {
    }
  }
  throw new TypeError(`Invalid x402 ${label} transaction`);
}
function assertResourceUrl(value) {
  if (typeof value !== "string") throw new TypeError("Invalid x402 payment ledger resource URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid x402 payment ledger resource URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new TypeError("Invalid x402 payment ledger resource URL");
}
function assertOccurredAt(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Invalid x402 payment ledger timestamp");
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export {
  X402_PAYMENT_LEDGER_SCHEMA,
  assertX402PaymentLedgerEvent,
  buildX402PaymentLedgerEvent,
  buildX402PaymentRefundLedgerEvent,
  x402PaymentLedgerId
};
