import { hashJson } from './hashing.mjs';
import { assertSafeJson } from '../shared/safe-json.mjs';
import { decodeBase58, SOLANA_MAINNET_CAIP2 } from './solana.mjs';
import type { X402PaymentContext, X402Settlement } from '../infrastructure/payments/x402-exact-evm.mjs';

/**
 * Immutable, privacy-minimised operational events for a paid x402 delivery.
 * The ledger stores a hash of the buyer payload, never the payload itself.
 */
export const X402_PAYMENT_LEDGER_SCHEMA = 'priorseal.x402-payment-ledger.v1';
export type X402PaymentLedgerEventType = 'PAYMENT_AUTHORIZED' | 'RESOURCE_WITHHELD' | 'SETTLEMENT_FAILED' | 'SETTLEMENT_UNKNOWN' | 'DELIVERED' | 'REFUND_RECORDED';
export type X402PaymentLedgerEvent = {
  schema: typeof X402_PAYMENT_LEDGER_SCHEMA;
  eventId: string;
  ledgerId: string;
  type: X402PaymentLedgerEventType;
  occurredAt: number;
  paymentPayloadHash?: string;
  requirement?: X402PaymentContext['requirement'];
  resource?: { url: string; responseStatus?: number; responseHash?: string };
  settlement?: X402Settlement;
  settlementAttempts?: number;
  paymentEvidenceId?: string;
  refund?: { network: string; transaction: string; amount: string; reasonCode: string };
};

type DeliveryEventInput = {
  type: Exclude<X402PaymentLedgerEventType, 'REFUND_RECORDED'>;
  context: X402PaymentContext;
  resourceUrl: string;
  occurredAt: number;
  responseStatus?: number;
  responseBody?: unknown;
  settlement?: X402Settlement;
  settlementAttempts?: number;
  paymentEvidenceId?: string;
};

export function x402PaymentLedgerId(context: X402PaymentContext, resourceUrl: string) {
  assertResourceUrl(resourceUrl);
  return `xpl_${hashJson({ paymentPayloadHash: hashJson(context.payload), requirement: context.requirement, resourceUrl }).slice(0, 32)}`;
}

export function buildX402PaymentLedgerEvent(input: DeliveryEventInput): X402PaymentLedgerEvent {
  const { type, context, resourceUrl, occurredAt, responseStatus, responseBody, settlement, settlementAttempts, paymentEvidenceId } = input;
  if (!['PAYMENT_AUTHORIZED', 'RESOURCE_WITHHELD', 'SETTLEMENT_FAILED', 'SETTLEMENT_UNKNOWN', 'DELIVERED'].includes(type)) throw new TypeError('Unsupported x402 payment ledger event type');
  assertSafeJson(context.payload);
  assertRequirement(context.requirement);
  assertResourceUrl(resourceUrl);
  assertOccurredAt(occurredAt);
  if (responseStatus !== undefined && (!Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599)) throw new TypeError('Invalid x402 payment ledger response status');
  if (settlement !== undefined) assertSettlement(settlement, context.requirement.network);
  if (settlementAttempts !== undefined && (!Number.isSafeInteger(settlementAttempts) || settlementAttempts < 1 || settlementAttempts > 2)) throw new TypeError('Invalid x402 payment ledger settlement attempt count');
  if (paymentEvidenceId !== undefined && !/^psp_[0-9a-f]{32}$/.test(paymentEvidenceId)) throw new TypeError('Invalid x402 payment evidence identifier');
  assertEventConsistency({ type, responseStatus, responseBody, settlement, settlementAttempts, paymentEvidenceId });
  const paymentPayloadHash = hashJson(context.payload);
  const resource = {
    url: resourceUrl,
    ...(responseStatus === undefined ? {} : { responseStatus }),
    ...(responseBody === undefined ? {} : { responseHash: hashJson(responseBody) }),
  };
  const unsigned = {
    schema: X402_PAYMENT_LEDGER_SCHEMA as typeof X402_PAYMENT_LEDGER_SCHEMA,
    ledgerId: `xpl_${hashJson({ paymentPayloadHash, requirement: context.requirement, resourceUrl }).slice(0, 32)}`,
    type,
    occurredAt,
    paymentPayloadHash,
    requirement: context.requirement,
    resource,
    ...(settlement === undefined ? {} : { settlement }),
    ...(settlementAttempts === undefined ? {} : { settlementAttempts }),
    ...(paymentEvidenceId === undefined ? {} : { paymentEvidenceId }),
  };
  return { ...unsigned, eventId: `xle_${hashJson(unsigned).slice(0, 32)}` };
}

/** Records a verified external refund without asserting that PriorSeal issued it. */
export function buildX402PaymentRefundLedgerEvent({ ledgerId, network, transaction, amount, reasonCode, occurredAt }: { ledgerId: string; network: string; transaction: string; amount: string; reasonCode: string; occurredAt: number }): X402PaymentLedgerEvent {
  if (!/^xpl_[0-9a-f]{32}$/.test(ledgerId) || !/^\d+$/.test(amount) || BigInt(amount) < 1n || !/^[A-Za-z0-9_.-]{1,128}$/.test(reasonCode)) throw new TypeError('Invalid x402 refund ledger event');
  assertSettlementTransaction(network, transaction, 'refund');
  assertOccurredAt(occurredAt);
  const unsigned = { schema: X402_PAYMENT_LEDGER_SCHEMA as typeof X402_PAYMENT_LEDGER_SCHEMA, ledgerId, type: 'REFUND_RECORDED' as const, occurredAt, refund: { network, transaction, amount, reasonCode } };
  return { ...unsigned, eventId: `xle_${hashJson(unsigned).slice(0, 32)}` };
}

/** Validates a record loaded from a persistence adapter before it becomes operational data. */
export function assertX402PaymentLedgerEvent(value: unknown): X402PaymentLedgerEvent {
  assertSafeJson(value);
  if (!record(value) || value.schema !== X402_PAYMENT_LEDGER_SCHEMA || typeof value.eventId !== 'string' || !/^xle_[0-9a-f]{32}$/.test(value.eventId) || typeof value.ledgerId !== 'string' || !/^xpl_[0-9a-f]{32}$/.test(value.ledgerId) || typeof value.type !== 'string' || !['PAYMENT_AUTHORIZED', 'RESOURCE_WITHHELD', 'SETTLEMENT_FAILED', 'SETTLEMENT_UNKNOWN', 'DELIVERED', 'REFUND_RECORDED'].includes(value.type)) throw new TypeError('Invalid persisted x402 payment ledger event');
  assertOccurredAt(value.occurredAt);
  if (value.type === 'REFUND_RECORDED') {
    if (!record(value.refund) || typeof value.refund.network !== 'string' || typeof value.refund.transaction !== 'string' || typeof value.refund.amount !== 'string' || typeof value.refund.reasonCode !== 'string') throw new TypeError('Invalid persisted x402 refund ledger event');
    if (!/^\d+$/.test(value.refund.amount) || BigInt(value.refund.amount) < 1n || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.refund.reasonCode)) throw new TypeError('Invalid persisted x402 refund ledger event');
    assertSettlementTransaction(value.refund.network, value.refund.transaction, 'refund');
    return value as X402PaymentLedgerEvent;
  }
  if (typeof value.paymentPayloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.paymentPayloadHash) || !record(value.requirement) || !record(value.resource)) throw new TypeError('Invalid persisted x402 payment ledger event');
  assertRequirement(value.requirement as X402PaymentContext['requirement']);
  assertResourceUrl(value.resource.url);
  const responseStatus = value.resource.responseStatus;
  if (responseStatus !== undefined && (typeof responseStatus !== 'number' || !Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599)) throw new TypeError('Invalid persisted x402 payment ledger response status');
  const responseHash = value.resource.responseHash;
  if (responseHash !== undefined && (typeof responseHash !== 'string' || !/^[0-9a-f]{64}$/.test(responseHash))) throw new TypeError('Invalid persisted x402 payment ledger response hash');
  if (value.settlement !== undefined) assertSettlement(value.settlement as X402Settlement, (value.requirement as X402PaymentContext['requirement']).network);
  const settlementAttempts = value.settlementAttempts;
  if (settlementAttempts !== undefined && (typeof settlementAttempts !== 'number' || !Number.isSafeInteger(settlementAttempts) || settlementAttempts < 1 || settlementAttempts > 2)) throw new TypeError('Invalid persisted x402 payment ledger settlement attempt count');
  if (value.paymentEvidenceId !== undefined && (typeof value.paymentEvidenceId !== 'string' || !/^psp_[0-9a-f]{32}$/.test(value.paymentEvidenceId))) throw new TypeError('Invalid persisted x402 payment evidence identifier');
  assertEventConsistency({ type: value.type as DeliveryEventInput['type'], responseStatus, responseBody: responseHash === undefined ? undefined : {}, settlement: value.settlement as X402Settlement | undefined, settlementAttempts: settlementAttempts as number | undefined, paymentEvidenceId: value.paymentEvidenceId as string | undefined });
  return value as X402PaymentLedgerEvent;
}

function assertRequirement(value: X402PaymentContext['requirement']) {
  if (!record(value) || value.scheme !== 'exact' || typeof value.network !== 'string' || typeof value.amount !== 'string' || !/^\d+$/.test(value.amount) || typeof value.asset !== 'string' || typeof value.payTo !== 'string' || !Number.isSafeInteger(value.maxTimeoutSeconds) || value.maxTimeoutSeconds < 1 || !record(value.extra) || !Object.values(value.extra).every(entry => typeof entry === 'string')) throw new TypeError('Invalid x402 payment ledger requirement');
}

function assertSettlement(value: X402Settlement, network: string) {
  if (!record(value) || typeof value.success !== 'boolean' || value.network !== network || typeof value.transaction !== 'string' || (value.errorReason !== undefined && typeof value.errorReason !== 'string') || (value.payer !== undefined && typeof value.payer !== 'string') || (value.amount !== undefined && (!/^\d+$/.test(value.amount)))) throw new TypeError('Invalid x402 payment ledger settlement');
  if (value.transaction) assertSettlementTransaction(network, value.transaction, 'settlement');
}

function assertEventConsistency({ type, responseStatus, responseBody, settlement, settlementAttempts, paymentEvidenceId }: { type: DeliveryEventInput['type']; responseStatus?: number; responseBody?: unknown; settlement?: X402Settlement; settlementAttempts?: number; paymentEvidenceId?: string }) {
  if (type === 'PAYMENT_AUTHORIZED' && (responseStatus !== undefined || responseBody !== undefined || settlement !== undefined || settlementAttempts !== undefined || paymentEvidenceId !== undefined)) throw new TypeError('Invalid payment-authorized ledger event');
  if (type === 'RESOURCE_WITHHELD' && (responseStatus === undefined || responseStatus >= 200 && responseStatus < 300 || settlement !== undefined || settlementAttempts !== undefined || paymentEvidenceId !== undefined)) throw new TypeError('Invalid resource-withheld ledger event');
  if (type === 'SETTLEMENT_FAILED' && (!settlement || settlement.success || responseStatus === undefined || responseStatus < 200 || responseStatus >= 300 || settlementAttempts === undefined || paymentEvidenceId !== undefined)) throw new TypeError('Invalid settlement-failed ledger event');
  if (type === 'SETTLEMENT_UNKNOWN' && (settlement !== undefined || responseStatus === undefined || responseStatus < 200 || responseStatus >= 300 || settlementAttempts !== undefined || paymentEvidenceId !== undefined)) throw new TypeError('Invalid settlement-unknown ledger event');
  if (type === 'DELIVERED' && (!settlement?.success || responseStatus === undefined || responseStatus < 200 || responseStatus >= 300 || responseBody === undefined || settlementAttempts === undefined)) throw new TypeError('Invalid delivered ledger event');
}

function assertSettlementTransaction(network: string, transaction: string, label: string) {
  if (/^eip155:[1-9]\d*$/.test(network) && /^0x[0-9a-fA-F]{64}$/.test(transaction)) return;
  if (network === SOLANA_MAINNET_CAIP2) {
    try { if (decodeBase58(transaction).length === 64) return; } catch { /* fail below */ }
  }
  throw new TypeError(`Invalid x402 ${label} transaction`);
}

function assertResourceUrl(value: unknown) {
  if (typeof value !== 'string') throw new TypeError('Invalid x402 payment ledger resource URL');
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('Invalid x402 payment ledger resource URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new TypeError('Invalid x402 payment ledger resource URL');
}

function assertOccurredAt(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new TypeError('Invalid x402 payment ledger timestamp');
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
