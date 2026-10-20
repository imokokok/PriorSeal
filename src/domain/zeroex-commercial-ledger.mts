import { hashJson } from './hashing.mjs';
import { decodeBase58 } from './solana.mjs';
import { assertSafeJson } from '../shared/safe-json.mjs';
import type { ZeroExCommercialRecord } from 'priorseal-sdk';

/**
 * An immutable record of a fee-bearing 0x relay attempt. This is deliberately
 * not a settlement ledger: it proves the fee terms and relay state, while the
 * Solana signature still has to be observed independently before revenue is
 * recognised.
 */
export const ZEROEX_COMMERCIAL_LEDGER_SCHEMA = 'priorseal.zeroex-commercial-ledger.v1';
export type ZeroExCommercialLedgerEventType = 'RELAY_ATTEMPTED' | 'RELAY_NOT_CLAIMED' | 'RELAY_SUBMITTED' | 'RELAY_UNKNOWN';

export type ZeroExCommercialLedgerTerms = {
  tenantId: string;
  fee: {
    profileId: string;
    side: 'sell';
    mint: string;
    feePpm: number;
    recipientTokenAccount: string;
    expectedAmountAtomic: string;
  };
  commitment: { namespace: 'priorseal.zeroex-commercial-record.v1'; algorithm: 'sha256'; digest: string };
};

export type ZeroExCommercialLedgerEvent = {
  schema: typeof ZEROEX_COMMERCIAL_LEDGER_SCHEMA;
  eventId: string;
  ledgerId: string;
  type: ZeroExCommercialLedgerEventType;
  occurredAt: number;
  authorizationId: string;
  intentHash: string;
  messageHash: string;
  transactionSignature: string;
  commercial: ZeroExCommercialLedgerTerms;
};

type LedgerEventInput = Omit<ZeroExCommercialLedgerEvent, 'schema' | 'eventId' | 'ledgerId' | 'commercial'> & {
  commercial: ZeroExCommercialRecord;
};

/** Creates a deterministic, idempotent event without retaining signed bytes. */
export function buildZeroExCommercialLedgerEvent(input: LedgerEventInput): ZeroExCommercialLedgerEvent {
  assertEventType(input.type);
  assertOccurredAt(input.occurredAt);
  assertAuthorizationId(input.authorizationId);
  assertIntentHash(input.intentHash);
  assertMessageHash(input.messageHash);
  assertTransactionSignature(input.transactionSignature);
  const commercial = commercialTerms(input.commercial);
  const ledgerId = zeroExCommercialLedgerId({ authorizationId: input.authorizationId, intentHash: input.intentHash, messageHash: input.messageHash, commercial });
  const unsigned = {
    schema: ZEROEX_COMMERCIAL_LEDGER_SCHEMA as typeof ZEROEX_COMMERCIAL_LEDGER_SCHEMA,
    ledgerId,
    type: input.type,
    occurredAt: input.occurredAt,
    authorizationId: input.authorizationId,
    intentHash: input.intentHash,
    messageHash: input.messageHash,
    transactionSignature: input.transactionSignature,
    commercial,
  };
  return { ...unsigned, eventId: `zce_${hashJson(unsigned).slice(0, 32)}` };
}

export function zeroExCommercialLedgerId(input: { authorizationId: string; intentHash: string; messageHash: string; commercial: ZeroExCommercialLedgerTerms }): string {
  assertAuthorizationId(input.authorizationId);
  assertIntentHash(input.intentHash);
  assertMessageHash(input.messageHash);
  assertCommercialTerms(input.commercial);
  return `zcl_${hashJson({ authorizationId: input.authorizationId, intentHash: input.intentHash, messageHash: input.messageHash, commercial: input.commercial }).slice(0, 32)}`;
}

/** Validates persisted ledger data before it influences reconciliation. */
export function assertZeroExCommercialLedgerEvent(value: unknown): ZeroExCommercialLedgerEvent {
  assertSafeJson(value);
  if (!record(value) || !exactKeys(value, ['authorizationId', 'commercial', 'eventId', 'intentHash', 'ledgerId', 'messageHash', 'occurredAt', 'schema', 'transactionSignature', 'type']) || value.schema !== ZEROEX_COMMERCIAL_LEDGER_SCHEMA || typeof value.eventId !== 'string' || !/^zce_[0-9a-f]{32}$/.test(value.eventId) || typeof value.ledgerId !== 'string' || !/^zcl_[0-9a-f]{32}$/.test(value.ledgerId)) throw new TypeError('Invalid persisted 0x commercial ledger event');
  const rebuilt = buildZeroExCommercialLedgerEvent({
    type: value.type as ZeroExCommercialLedgerEventType,
    occurredAt: value.occurredAt as number,
    authorizationId: value.authorizationId as string,
    intentHash: value.intentHash as string,
    messageHash: value.messageHash as string,
    transactionSignature: value.transactionSignature as string,
    commercial: commercialRecordFromTerms(value.commercial),
  });
  if (rebuilt.eventId !== value.eventId || rebuilt.ledgerId !== value.ledgerId || hashJson(rebuilt) !== hashJson(value)) throw new TypeError('Persisted 0x commercial ledger event does not match its deterministic identity');
  return rebuilt;
}

export type ZeroExCommercialReconciliation = {
  ledgerId: string;
  authorizationId: string;
  intentHash: string;
  messageHash: string;
  transactionSignature: string;
  tenantId: string;
  feeProfileId: string;
  feeMint: string;
  expectedFeeAtomic: string;
  recipientTokenAccount: string;
  relayStatus: 'NOT_CLAIMED' | 'RELAYED_UNCONFIRMED' | 'RELAY_UNKNOWN' | 'ATTEMPT_RECORDED';
  firstAttemptAt: number;
  lastUpdatedAt: number;
};

/**
 * Produces a conservative reconciliation row. `RELAYED_UNCONFIRMED` never
 * means the token fee settled; callers must combine it with a chain observation
 * before recognising revenue.
 */
export function reconcileZeroExCommercialLedger(events: ZeroExCommercialLedgerEvent[]): ZeroExCommercialReconciliation {
  if (!Array.isArray(events) || events.length === 0) throw new TypeError('0x commercial ledger reconciliation requires at least one event');
  const validated = events.map(assertZeroExCommercialLedgerEvent);
  const first = validated[0]!;
  if (validated.some(event => event.ledgerId !== first.ledgerId || event.authorizationId !== first.authorizationId || event.intentHash !== first.intentHash || event.messageHash !== first.messageHash || event.transactionSignature !== first.transactionSignature || hashJson(event.commercial) !== hashJson(first.commercial))) throw new TypeError('0x commercial ledger events do not describe one relay');
  const types = new Set(validated.map(event => event.type));
  const relayStatus = types.has('RELAY_SUBMITTED') ? 'RELAYED_UNCONFIRMED'
    : types.has('RELAY_UNKNOWN') ? 'RELAY_UNKNOWN'
      : types.has('RELAY_NOT_CLAIMED') ? 'NOT_CLAIMED'
        : 'ATTEMPT_RECORDED';
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
    firstAttemptAt: Math.min(...validated.map(event => event.occurredAt)),
    lastUpdatedAt: Math.max(...validated.map(event => event.occurredAt)),
  };
}

function commercialTerms(value: ZeroExCommercialRecord): ZeroExCommercialLedgerTerms {
  if (!value || value.schema !== 'priorseal.zeroex-commercial-record.v1' || value.provider !== '0x' || !value.fee) throw new TypeError('0x commercial ledger requires a fee-bearing 0x commercial record');
  const terms = {
    tenantId: value.tenantId,
    fee: {
      profileId: value.fee.profileId,
      side: value.fee.side,
      mint: value.fee.mint,
      feePpm: value.fee.feePpm,
      recipientTokenAccount: value.fee.recipientTokenAccount,
      expectedAmountAtomic: value.fee.expectedAmountAtomic,
    },
    commitment: {
      namespace: value.commitment.namespace,
      algorithm: value.commitment.algorithm,
      digest: value.commitment.digest,
    },
  };
  assertCommercialTerms(terms);
  return terms;
}

function commercialRecordFromTerms(value: unknown): ZeroExCommercialRecord {
  assertCommercialTerms(value);
  return {
    schema: 'priorseal.zeroex-commercial-record.v1',
    provider: '0x',
    tenantId: value.tenantId,
    fee: { ...value.fee },
    commitment: { ...value.commitment },
  };
}

function assertCommercialTerms(value: unknown): asserts value is ZeroExCommercialLedgerTerms {
  if (!record(value) || !exactKeys(value, ['commitment', 'fee', 'tenantId']) || typeof value.tenantId !== 'string' || !IDENTIFIER.test(value.tenantId) || !record(value.fee) || !exactKeys(value.fee, ['expectedAmountAtomic', 'feePpm', 'mint', 'profileId', 'recipientTokenAccount', 'side']) || typeof value.fee.profileId !== 'string' || !IDENTIFIER.test(value.fee.profileId) || value.fee.side !== 'sell' || typeof value.fee.mint !== 'string' || !BASE58.test(value.fee.mint) || typeof value.fee.recipientTokenAccount !== 'string' || !BASE58.test(value.fee.recipientTokenAccount) || typeof value.fee.feePpm !== 'number' || !Number.isSafeInteger(value.fee.feePpm) || value.fee.feePpm < 1 || value.fee.feePpm > 100_000 || typeof value.fee.expectedAmountAtomic !== 'string' || !POSITIVE_ATOMIC.test(value.fee.expectedAmountAtomic) || !record(value.commitment) || !exactKeys(value.commitment, ['algorithm', 'digest', 'namespace']) || value.commitment.namespace !== 'priorseal.zeroex-commercial-record.v1' || value.commitment.algorithm !== 'sha256' || typeof value.commitment.digest !== 'string' || !/^0x[0-9a-f]{64}$/.test(value.commitment.digest)) throw new TypeError('Invalid 0x commercial ledger terms');
}

function assertEventType(value: unknown): asserts value is ZeroExCommercialLedgerEventType {
  if (!['RELAY_ATTEMPTED', 'RELAY_NOT_CLAIMED', 'RELAY_SUBMITTED', 'RELAY_UNKNOWN'].includes(String(value))) throw new TypeError('Invalid 0x commercial ledger event type');
}

function assertAuthorizationId(value: unknown) { if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new TypeError('Invalid 0x commercial ledger authorization identifier'); }
function assertOccurredAt(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError('Invalid 0x commercial ledger timestamp'); }
function assertIntentHash(value: unknown) { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError('Invalid 0x commercial ledger intent hash'); }
function assertMessageHash(value: unknown) { if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) throw new TypeError('Invalid 0x commercial ledger message hash'); }
function assertTransactionSignature(value: unknown) { if (typeof value !== 'string' || value.length < 64 || value.length > 128) throw new TypeError('Invalid 0x commercial ledger transaction signature'); try { if (decodeBase58(value).length !== 64) throw new Error('length'); } catch { throw new TypeError('Invalid 0x commercial ledger transaction signature'); } }
function exactKeys(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).sort().join(',') === keys.sort().join(','); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const POSITIVE_ATOMIC = /^(?:[1-9][0-9]*)$/;
