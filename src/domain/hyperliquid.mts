import { PriorSealError } from './errors.mjs';
import { assertOnlyFields } from '../shared/safe-json.mjs';
import { evmAddress, uintString } from './values.mjs';

/** HyperCore is not an EVM transaction stream. `chainId: 0` is paired with
 * this explicit network reference so it can never be confused with HyperEVM
 * (EIP-155 chain 999) or Solana. */
/** PriorSeal network reference for HyperCore mainnet. It is deliberately not
 * presented as a CAIP-2 identifier: HyperCore order actions are not EVM
 * transactions and this reference scopes the profile-specific `chainId: 0`. */
export const HYPERLIQUID_MAINNET_CHAIN_REF = 'hyperliquid:mainnet';
export const HYPERLIQUID_SPOT_IOC_PROFILE = 'priorseal.execution-profile.hyperliquid-spot-ioc.v1';
export const HYPERLIQUID_SPOT_IOC_ACTION = 'HYPERLIQUID_SPOT_IOC_ORDER';
/** IOC orders should be handed to the user-controlled exchange client immediately.
 * Keeping this short prevents a signed cloid from becoming a long-lived action. */
export const HYPERLIQUID_MAX_SPOT_IOC_LIFETIME_MS = 5 * 60_000;
/** Outcome order assets use a separate 100,000,000+ encoding and are not spot
 * pairs for this profile. */
export const HYPERLIQUID_OUTCOME_ASSET_ID_MIN = 100_000_000;

/** Hyperliquid's Info API has more terminal states than the three generic
 * outcomes. Preserve its raw state in evidence while deriving a safe class. */
export const HYPERLIQUID_TERMINAL_ORDER_STATUSES = [
  'filled',
  'canceled', 'marginCanceled', 'vaultWithdrawalCanceled', 'openInterestCapCanceled',
  'selfTradeCanceled', 'reduceOnlyCanceled', 'siblingFilledCanceled', 'delistedCanceled',
  'liquidatedCanceled', 'scheduledCancel',
  'rejected', 'tickRejected', 'minTradeNtlRejected', 'perpMarginRejected',
  'reduceOnlyRejected', 'badAloPxRejected', 'iocCancelRejected', 'badTriggerPxRejected',
  'marketOrderNoLiquidityRejected', 'positionIncreaseAtOpenInterestCapRejected',
  'positionFlipAtOpenInterestCapRejected', 'tooAggressiveAtOpenInterestCapRejected',
  'openInterestIncreaseRejected', 'insufficientSpotBalanceRejected', 'oracleRejected',
  'perpMaxPositionRejected',
] as const;
export type HyperliquidTerminalOrderStatus = typeof HYPERLIQUID_TERMINAL_ORDER_STATUSES[number];
export type HyperliquidTerminalDisposition = 'FILLED' | 'CANCELED' | 'REJECTED';

export type HyperliquidSpotIocOrder = {
  assetId: number;
  isBuy: boolean;
  limitPrice: string;
  size: string;
  timeInForce: 'Ioc';
  clientOrderId: string;
  expiresAfter: number;
};

export type HyperliquidSpotIocExecution = HyperliquidSpotIocOrder & {
  orderId: string;
  orderStatus: HyperliquidTerminalOrderStatus;
  filledSize: string;
  averagePrice: string | null;
  fee: string | null;
  statusTimestamp: number;
};

/** Digest-only provenance for responses that remain in the operator's private
 * evidence archive. The receipt stays portable without copying high-volume raw
 * exchange payloads into it. */
export type HyperliquidInfoObservationEvidence = {
  schema: 'priorseal.hyperliquid-info-observation.v1';
  endpointHash: string;
  orderStatusRequestHash: string;
  orderStatusResponseHash: string;
  fillRequestHashes: string[];
  fillResponseHashes: string[];
  fillPageCount: number;
  fillResponseCount: number;
  relevantFillCount: number;
  fillsComplete: boolean;
  observedAtMillis: number;
};

export function normalizeHyperliquidSpotIocOrder(value: unknown): HyperliquidSpotIocOrder {
  const input = assertOnlyFields(value, ['assetId', 'isBuy', 'limitPrice', 'size', 'timeInForce', 'clientOrderId', 'expiresAfter'], 'hyperliquidOrder');
  if (!Number.isSafeInteger(input.assetId) || Number(input.assetId) < 10_000 || Number(input.assetId) >= HYPERLIQUID_OUTCOME_ASSET_ID_MIN) throw new PriorSealError('INVALID_HYPERLIQUID_ORDER', 'Hyperliquid spot assetId must be a spot-pair integer from 10000 through 99999999');
  if (typeof input.isBuy !== 'boolean') throw new PriorSealError('INVALID_HYPERLIQUID_ORDER', 'Hyperliquid isBuy must be a boolean');
  if (input.timeInForce !== 'Ioc') throw new PriorSealError('INVALID_HYPERLIQUID_ORDER', 'Only Hyperliquid IOC orders are supported');
  if (typeof input.clientOrderId !== 'string' || !/^0x[0-9a-fA-F]{32}$/.test(input.clientOrderId)) throw new PriorSealError('INVALID_HYPERLIQUID_ORDER', 'Hyperliquid clientOrderId must be a 16-byte hex cloid');
  if (!Number.isSafeInteger(input.expiresAfter) || Number(input.expiresAfter) <= 0) throw new PriorSealError('INVALID_HYPERLIQUID_ORDER', 'Hyperliquid expiresAfter must be a positive millisecond timestamp');
  return {
    assetId: Number(input.assetId),
    isBuy: input.isBuy,
    limitPrice: decimal(input.limitPrice, 'limitPrice'),
    size: positiveDecimal(input.size, 'size'),
    timeInForce: 'Ioc',
    clientOrderId: input.clientOrderId.toLowerCase(),
    expiresAfter: Number(input.expiresAfter),
  };
}

export function normalizeHyperliquidSpotIocExecution(value: unknown): HyperliquidSpotIocExecution {
  const input = assertOnlyFields(value, ['assetId', 'isBuy', 'limitPrice', 'size', 'timeInForce', 'clientOrderId', 'expiresAfter', 'orderId', 'orderStatus', 'filledSize', 'averagePrice', 'fee', 'statusTimestamp'], 'hyperliquidExecution');
  const order = normalizeHyperliquidSpotIocOrder({
    assetId: input.assetId,
    isBuy: input.isBuy,
    limitPrice: input.limitPrice,
    size: input.size,
    timeInForce: input.timeInForce,
    clientOrderId: input.clientOrderId,
    expiresAfter: input.expiresAfter,
  });
  if (!/^(0|[1-9][0-9]*)$/.test(String(input.orderId ?? ''))) throw new PriorSealError('INVALID_HYPERLIQUID_EXECUTION', 'Hyperliquid orderId must be an unsigned integer');
  const disposition = hyperliquidTerminalDisposition(input.orderStatus);
  if (!disposition) throw new PriorSealError('INVALID_HYPERLIQUID_EXECUTION', 'Hyperliquid orderStatus is not terminal');
  if (!Number.isSafeInteger(input.statusTimestamp) || Number(input.statusTimestamp) <= 0) throw new PriorSealError('INVALID_HYPERLIQUID_EXECUTION', 'Hyperliquid statusTimestamp must be a positive millisecond timestamp');
  const filledSize = decimal(input.filledSize, 'filledSize');
  const averagePrice = input.averagePrice === null ? null : positiveDecimal(input.averagePrice, 'averagePrice');
  const fee = input.fee === null ? null : decimal(input.fee, 'fee');
  if (compareDecimal(filledSize, order.size) > 0) throw new PriorSealError('INVALID_HYPERLIQUID_EXECUTION', 'Hyperliquid filledSize exceeds the authorized order size');
  if (disposition === 'FILLED' && compareDecimal(filledSize, order.size) !== 0) throw new PriorSealError('INVALID_HYPERLIQUID_EXECUTION', 'A filled Hyperliquid order requires complete fill evidence');
  if (disposition === 'REJECTED' && compareDecimal(filledSize, '0') !== 0) throw new PriorSealError('INVALID_HYPERLIQUID_EXECUTION', 'A rejected Hyperliquid order cannot have fills');
  if (compareDecimal(filledSize, '0') === 0 && averagePrice !== null) throw new PriorSealError('INVALID_HYPERLIQUID_EXECUTION', 'A zero-fill order cannot have an average price');
  if (compareDecimal(filledSize, '0') > 0 && averagePrice === null) throw new PriorSealError('INVALID_HYPERLIQUID_EXECUTION', 'A nonzero fill requires an average price');
  if (averagePrice !== null && (order.isBuy ? compareDecimal(averagePrice, order.limitPrice) > 0 : compareDecimal(averagePrice, order.limitPrice) < 0)) throw new PriorSealError('INVALID_HYPERLIQUID_EXECUTION', 'Hyperliquid fill price exceeds the authorized IOC limit');
  return { ...order, orderId: String(input.orderId), orderStatus: input.orderStatus as HyperliquidTerminalOrderStatus, filledSize, averagePrice, fee, statusTimestamp: Number(input.statusTimestamp) };
}

export function hyperliquidTerminalDisposition(value: unknown): HyperliquidTerminalDisposition | null {
  if (value === 'filled') return 'FILLED';
  if (typeof value !== 'string' || !HYPERLIQUID_TERMINAL_ORDER_STATUSES.includes(value as HyperliquidTerminalOrderStatus)) return null;
  return value.endsWith('Rejected') || value === 'rejected' ? 'REJECTED' : 'CANCELED';
}

export function normalizeHyperliquidInfoObservationEvidence(value: unknown): HyperliquidInfoObservationEvidence {
  const input = assertOnlyFields(value, ['schema', 'endpointHash', 'orderStatusRequestHash', 'orderStatusResponseHash', 'fillRequestHashes', 'fillResponseHashes', 'fillPageCount', 'fillResponseCount', 'relevantFillCount', 'fillsComplete', 'observedAtMillis'], 'hyperliquidInfoObservation');
  const hash = (field: string) => {
    if (typeof input[field] !== 'string' || !/^[0-9a-f]{64}$/.test(input[field] as string)) throw new PriorSealError('INVALID_HYPERLIQUID_EVIDENCE', `Hyperliquid ${field} must be a SHA-256 digest`);
    return input[field] as string;
  };
  const hashes = (field: string) => {
    if (!Array.isArray(input[field]) || input[field].length > 100 || input[field].some(item => typeof item !== 'string' || !/^[0-9a-f]{64}$/.test(item))) throw new PriorSealError('INVALID_HYPERLIQUID_EVIDENCE', `Hyperliquid ${field} must be a bounded digest array`);
    return input[field] as string[];
  };
  const count = (field: string) => {
    if (!Number.isSafeInteger(input[field]) || Number(input[field]) < 0 || Number(input[field]) > 1_000_000) throw new PriorSealError('INVALID_HYPERLIQUID_EVIDENCE', `Hyperliquid ${field} must be a bounded non-negative integer`);
    return Number(input[field]);
  };
  if (input.schema !== 'priorseal.hyperliquid-info-observation.v1') throw new PriorSealError('INVALID_HYPERLIQUID_EVIDENCE', 'Unsupported Hyperliquid Info observation evidence schema');
  if (typeof input.fillsComplete !== 'boolean') throw new PriorSealError('INVALID_HYPERLIQUID_EVIDENCE', 'Hyperliquid fillsComplete must be a boolean');
  if (!Number.isSafeInteger(input.observedAtMillis) || Number(input.observedAtMillis) <= 0) throw new PriorSealError('INVALID_HYPERLIQUID_EVIDENCE', 'Hyperliquid observedAtMillis must be a positive millisecond timestamp');
  const fillRequestHashes = hashes('fillRequestHashes');
  const fillResponseHashes = hashes('fillResponseHashes');
  const fillPageCount = count('fillPageCount');
  if (fillRequestHashes.length !== fillResponseHashes.length || fillPageCount !== fillRequestHashes.length) throw new PriorSealError('INVALID_HYPERLIQUID_EVIDENCE', 'Hyperliquid fill evidence page counts do not agree');
  return { schema: 'priorseal.hyperliquid-info-observation.v1', endpointHash: hash('endpointHash'), orderStatusRequestHash: hash('orderStatusRequestHash'), orderStatusResponseHash: hash('orderStatusResponseHash'), fillRequestHashes, fillResponseHashes, fillPageCount, fillResponseCount: count('fillResponseCount'), relevantFillCount: count('relevantFillCount'), fillsComplete: input.fillsComplete, observedAtMillis: Number(input.observedAtMillis) };
}

export function hyperliquidSpotAssetId(asset: string): number {
  const match = /^hyperliquid:mainnet\/spot:([1-9][0-9]*)$/.exec(asset);
  if (!match || Number(match[1]) < 10_000 || Number(match[1]) >= HYPERLIQUID_OUTCOME_ASSET_ID_MIN || !Number.isSafeInteger(Number(match[1]))) throw new PriorSealError('INVALID_ASSET', 'asset must be hyperliquid:mainnet/spot:<assetId>');
  return Number(match[1]);
}

export function isHyperliquidCloid(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{32}$/.test(value);
}

/** Stable persistence key for a profile-bound cloid. It is intentionally
 * scoped by both account and HyperCore network reference. */
export function hyperliquidCloidReservation(intent: { executionProfile?: unknown; chainRef?: unknown; sender?: unknown; hyperliquidOrder?: { clientOrderId?: unknown } | null }): { networkRef: string; account: string; clientOrderId: string } | null {
  if (intent.executionProfile !== HYPERLIQUID_SPOT_IOC_PROFILE || intent.chainRef !== HYPERLIQUID_MAINNET_CHAIN_REF || typeof intent.sender !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(intent.sender) || !isHyperliquidCloid(intent.hyperliquidOrder?.clientOrderId)) return null;
  return { networkRef: HYPERLIQUID_MAINNET_CHAIN_REF, account: intent.sender.toLowerCase(), clientOrderId: intent.hyperliquidOrder.clientOrderId.toLowerCase() };
}

export function sameHyperliquidSpotIocOrder(expected: HyperliquidSpotIocOrder | null | undefined, observed: HyperliquidSpotIocExecution | null | undefined): boolean {
  return Boolean(expected && observed
    && expected.assetId === observed.assetId
    && expected.isBuy === observed.isBuy
    && expected.limitPrice === observed.limitPrice
    && expected.size === observed.size
    && expected.timeInForce === observed.timeInForce
    && expected.clientOrderId === observed.clientOrderId
    && expected.expiresAfter === observed.expiresAfter);
}

export function normalizeHyperliquidAccount(value: unknown, field: string): string {
  return evmAddress(value, field);
}

export function normalizeHyperliquidNonce(value: unknown): string {
  const nonce = uintString(value, 'nonce');
  if (BigInt(nonce) < 1_000_000_000_000n || BigInt(nonce) > BigInt(Number.MAX_SAFE_INTEGER)) throw new PriorSealError('INVALID_HYPERLIQUID_ORDER', 'Hyperliquid nonce must be a safe millisecond timestamp');
  return nonce;
}

function positiveDecimal(value: unknown, field: string): string {
  const normalized = decimal(value, field);
  if (compareDecimal(normalized, '0') <= 0) throw new PriorSealError('INVALID_HYPERLIQUID_ORDER', `Hyperliquid ${field} must be positive`);
  return normalized;
}

function decimal(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) throw new PriorSealError('INVALID_HYPERLIQUID_ORDER', `Hyperliquid ${field} must be a non-negative decimal string with at most 18 decimals`);
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const factor = 10n ** BigInt(scale);
  const asInteger = (whole: string, fraction: string) => BigInt(whole) * factor + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
  const difference = asInteger(leftWhole, leftFraction) - asInteger(rightWhole, rightFraction);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}
