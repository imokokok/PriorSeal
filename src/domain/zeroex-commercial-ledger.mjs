// Generated from zeroex-commercial-ledger.mts by npm run core:build. Do not edit directly.
import { hashJson } from "./hashing.mjs";
import { decodeBase58 } from "./solana.mjs";
import { assertSafeJson } from "../shared/safe-json.mjs";
const ZEROEX_COMMERCIAL_LEDGER_SCHEMA = "priorseal.zeroex-commercial-ledger.v1";
function buildZeroExCommercialLedgerEvent(input) {
  assertEventType(input.type);
  assertOccurredAt(input.occurredAt);
  assertAuthorizationId(input.authorizationId);
  assertIntentHash(input.intentHash);
  assertMessageHash(input.messageHash);
  assertTransactionSignature(input.transactionSignature);
  const commercial = commercialTerms(input.commercial);
  const ledgerId = zeroExCommercialLedgerId({ authorizationId: input.authorizationId, intentHash: input.intentHash, messageHash: input.messageHash, commercial });
  const unsigned = {
    schema: ZEROEX_COMMERCIAL_LEDGER_SCHEMA,
    ledgerId,
    type: input.type,
    occurredAt: input.occurredAt,
    authorizationId: input.authorizationId,
    intentHash: input.intentHash,
    messageHash: input.messageHash,
    transactionSignature: input.transactionSignature,
    commercial
  };
  return { ...unsigned, eventId: `zce_${hashJson(unsigned).slice(0, 32)}` };
}
function zeroExCommercialLedgerId(input) {
  assertAuthorizationId(input.authorizationId);
  assertIntentHash(input.intentHash);
  assertMessageHash(input.messageHash);
  assertCommercialTerms(input.commercial);
  return `zcl_${hashJson({ authorizationId: input.authorizationId, intentHash: input.intentHash, messageHash: input.messageHash, commercial: input.commercial }).slice(0, 32)}`;
}
function assertZeroExCommercialLedgerEvent(value) {
  assertSafeJson(value);
  if (!record(value) || !exactKeys(value, ["authorizationId", "commercial", "eventId", "intentHash", "ledgerId", "messageHash", "occurredAt", "schema", "transactionSignature", "type"]) || value.schema !== ZEROEX_COMMERCIAL_LEDGER_SCHEMA || typeof value.eventId !== "string" || !/^zce_[0-9a-f]{32}$/.test(value.eventId) || typeof value.ledgerId !== "string" || !/^zcl_[0-9a-f]{32}$/.test(value.ledgerId)) throw new TypeError("Invalid persisted 0x commercial ledger event");
  const rebuilt = buildZeroExCommercialLedgerEvent({
    type: value.type,
    occurredAt: value.occurredAt,
    authorizationId: value.authorizationId,
    intentHash: value.intentHash,
    messageHash: value.messageHash,
    transactionSignature: value.transactionSignature,
    commercial: commercialRecordFromTerms(value.commercial)
  });
  if (rebuilt.eventId !== value.eventId || rebuilt.ledgerId !== value.ledgerId || hashJson(rebuilt) !== hashJson(value)) throw new TypeError("Persisted 0x commercial ledger event does not match its deterministic identity");
  return rebuilt;
}
function reconcileZeroExCommercialLedger(events) {
  if (!Array.isArray(events) || events.length === 0) throw new TypeError("0x commercial ledger reconciliation requires at least one event");
  const validated = events.map(assertZeroExCommercialLedgerEvent);
  const first = validated[0];
  if (validated.some((event) => event.ledgerId !== first.ledgerId || event.authorizationId !== first.authorizationId || event.intentHash !== first.intentHash || event.messageHash !== first.messageHash || event.transactionSignature !== first.transactionSignature || hashJson(event.commercial) !== hashJson(first.commercial))) throw new TypeError("0x commercial ledger events do not describe one relay");
  const types = new Set(validated.map((event) => event.type));
  const relayStatus = types.has("RELAY_SUBMITTED") ? "RELAYED_UNCONFIRMED" : types.has("RELAY_UNKNOWN") ? "RELAY_UNKNOWN" : types.has("RELAY_NOT_CLAIMED") ? "NOT_CLAIMED" : "ATTEMPT_RECORDED";
  const fee = first.commercial.fee;
  return {
    ledgerId: first.ledgerId,
    authorizationId: first.authorizationId,
    intentHash: first.intentHash,
    messageHash: first.messageHash,
    transactionSignature: first.transactionSignature,
    tenantId: first.commercial.tenantId,
    feeProfileId: fee.profileId,
    feeMint: fee.mint,
    expectedFeeAtomic: fee.expectedAmountAtomic,
    recipientTokenAccount: fee.recipientTokenAccount,
    relayStatus,
    firstAttemptAt: Math.min(...validated.map((event) => event.occurredAt)),
    lastUpdatedAt: Math.max(...validated.map((event) => event.occurredAt))
  };
}
function commercialTerms(value) {
  if (!value || value.schema !== "priorseal.zeroex-commercial-record.v1" || value.provider !== "0x" || !value.fee) throw new TypeError("0x commercial ledger requires a fee-bearing 0x commercial record");
  const terms = {
    tenantId: value.tenantId,
    fee: {
      profileId: value.fee.profileId,
      side: value.fee.side,
      mint: value.fee.mint,
      feePpm: value.fee.feePpm,
      recipientTokenAccount: value.fee.recipientTokenAccount,
      expectedAmountAtomic: value.fee.expectedAmountAtomic
    },
    commitment: {
      namespace: value.commitment.namespace,
      algorithm: value.commitment.algorithm,
      digest: value.commitment.digest
    }
  };
  assertCommercialTerms(terms);
  return terms;
}
function commercialRecordFromTerms(value) {
  assertCommercialTerms(value);
  return {
    schema: "priorseal.zeroex-commercial-record.v1",
    provider: "0x",
    tenantId: value.tenantId,
    fee: { ...value.fee },
    commitment: { ...value.commitment }
  };
}
function assertCommercialTerms(value) {
  if (!record(value) || !exactKeys(value, ["commitment", "fee", "tenantId"]) || typeof value.tenantId !== "string" || !IDENTIFIER.test(value.tenantId) || !record(value.fee) || !exactKeys(value.fee, ["expectedAmountAtomic", "feePpm", "mint", "profileId", "recipientTokenAccount", "side"]) || typeof value.fee.profileId !== "string" || !IDENTIFIER.test(value.fee.profileId) || value.fee.side !== "sell" || typeof value.fee.mint !== "string" || !BASE58.test(value.fee.mint) || typeof value.fee.recipientTokenAccount !== "string" || !BASE58.test(value.fee.recipientTokenAccount) || typeof value.fee.feePpm !== "number" || !Number.isSafeInteger(value.fee.feePpm) || value.fee.feePpm < 1 || value.fee.feePpm > 1e5 || typeof value.fee.expectedAmountAtomic !== "string" || !POSITIVE_ATOMIC.test(value.fee.expectedAmountAtomic) || !record(value.commitment) || !exactKeys(value.commitment, ["algorithm", "digest", "namespace"]) || value.commitment.namespace !== "priorseal.zeroex-commercial-record.v1" || value.commitment.algorithm !== "sha256" || typeof value.commitment.digest !== "string" || !/^0x[0-9a-f]{64}$/.test(value.commitment.digest)) throw new TypeError("Invalid 0x commercial ledger terms");
}
function assertEventType(value) {
  if (!["RELAY_ATTEMPTED", "RELAY_NOT_CLAIMED", "RELAY_SUBMITTED", "RELAY_UNKNOWN"].includes(String(value))) throw new TypeError("Invalid 0x commercial ledger event type");
}
function assertAuthorizationId(value) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new TypeError("Invalid 0x commercial ledger authorization identifier");
}
function assertOccurredAt(value) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError("Invalid 0x commercial ledger timestamp");
}
function assertIntentHash(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError("Invalid 0x commercial ledger intent hash");
}
function assertMessageHash(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) throw new TypeError("Invalid 0x commercial ledger message hash");
}
function assertTransactionSignature(value) {
  if (typeof value !== "string" || value.length < 64 || value.length > 128) throw new TypeError("Invalid 0x commercial ledger transaction signature");
  try {
    if (decodeBase58(value).length !== 64) throw new Error("length");
  } catch {
    throw new TypeError("Invalid 0x commercial ledger transaction signature");
  }
}
function exactKeys(value, keys) {
  return Object.keys(value).sort().join(",") === keys.sort().join(",");
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const POSITIVE_ATOMIC = /^(?:[1-9][0-9]*)$/;
export {
  ZEROEX_COMMERCIAL_LEDGER_SCHEMA,
  assertZeroExCommercialLedgerEvent,
  buildZeroExCommercialLedgerEvent,
  reconcileZeroExCommercialLedger,
  zeroExCommercialLedgerId
};
