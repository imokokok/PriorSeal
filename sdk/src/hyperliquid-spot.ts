import { parseContextCommitments } from './exact-call.js'
import type { ContextCommitment, HyperliquidSpotIocOrder, Intent } from './types.js'

export const HYPERLIQUID_MAINNET_CHAIN_REF = 'hyperliquid:mainnet'
export const HYPERLIQUID_SPOT_IOC_PROFILE = 'priorseal.execution-profile.hyperliquid-spot-ioc.v1'
export const HYPERLIQUID_SPOT_IOC_ACTION = 'HYPERLIQUID_SPOT_IOC_ORDER'
export const HYPERLIQUID_MAX_SPOT_IOC_LIFETIME_MS = 5 * 60_000
export const HYPERLIQUID_OUTCOME_ASSET_ID_MIN = 100_000_000

export type HyperliquidSpotIocIntentInput = {
  intentId: string
  /** Hyperliquid main account. This first profile requires it to be the delegate executor too. */
  account: string
  /** PriorSeal policy counter in unsigned atomic units; the exact base size is committed separately. */
  amount: bigint | number | string
  assetId: number
  isBuy: boolean
  limitPrice: string
  size: string
  clientOrderId: string
  /** Hyperliquid action nonce in epoch milliseconds. */
  nonce: bigint | number | string
  /** Hyperliquid action expiry in epoch milliseconds. */
  expiresAfter: number
  /** PriorSeal validity in Unix seconds; it cannot outlive `expiresAfter`. */
  validUntil: number
  contextCommitments?: ContextCommitment[]
  constraints?: Intent['constraints']
}

/**
 * Build a non-custodial, observation-only HyperCore spot IOC authorization
 * intent. This helper never produces an exchange action signature or submits
 * an order to Hyperliquid.
 */
export function buildHyperliquidSpotIocIntent(input: HyperliquidSpotIocIntentInput): Intent {
  identifier(input.intentId, 'intentId')
  const account = address(input.account, 'account')
  const order: HyperliquidSpotIocOrder = {
    assetId: assetId(input.assetId),
    isBuy: boolean(input.isBuy, 'isBuy'),
    limitPrice: decimal(input.limitPrice, 'limitPrice', false),
    size: decimal(input.size, 'size', true),
    timeInForce: 'Ioc',
    clientOrderId: cloid(input.clientOrderId),
    expiresAfter: milliseconds(input.expiresAfter, 'expiresAfter'),
  }
  const nonce = milliseconds(input.nonce, 'nonce').toString(10)
  if (BigInt(nonce) >= BigInt(order.expiresAfter)) throw new TypeError('expiresAfter must be later than nonce')
  if (BigInt(order.expiresAfter) - BigInt(nonce) > BigInt(HYPERLIQUID_MAX_SPOT_IOC_LIFETIME_MS)) throw new TypeError(`expiresAfter must be within ${HYPERLIQUID_MAX_SPOT_IOC_LIFETIME_MS}ms of nonce`)
  if (!Number.isSafeInteger(input.validUntil) || input.validUntil <= 0 || input.validUntil > Math.floor(order.expiresAfter / 1000)) throw new TypeError('validUntil must be positive Unix seconds no later than expiresAfter')
  validateConstraints(input.constraints)
  return {
    schema: 'priorseal.intent.v2',
    executionProfile: HYPERLIQUID_SPOT_IOC_PROFILE,
    intentId: input.intentId,
    chainId: 0,
    chainRef: HYPERLIQUID_MAINNET_CHAIN_REF,
    action: HYPERLIQUID_SPOT_IOC_ACTION,
    asset: `hyperliquid:mainnet/spot:${order.assetId}`,
    amount: uintString(input.amount, 'amount'),
    sender: account,
    recipient: account,
    validUntil: input.validUntil,
    nonce,
    hyperliquidOrder: order,
    ...(input.contextCommitments ? { contextCommitments: parseContextCommitments(input.contextCommitments) } : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
  }
}

export type HyperliquidSpotIocSubmission = {
  schema: 'priorseal.hyperliquid-spot-ioc-submission.v1'
  account: string
  clientOrderId: string
  nonce: number
  expiresAfter: number
  action: {
    type: 'order'
    orders: Array<{ a: number; b: boolean; p: string; s: string; r: false; t: { limit: { tif: 'Ioc' } }; c: string }>
    grouping: 'na'
  }
}

/**
 * Serializes the signed PriorSeal intent into Hyperliquid's official order
 * action shape. It intentionally omits signature, vaultAddress, and transport:
 * the user-controlled execution client must sign and submit with Hyperliquid's
 * official SDK, then return the same cloid for observation.
 */
export function buildHyperliquidSpotIocSubmission(intent: Intent): HyperliquidSpotIocSubmission {
  if (intent.executionProfile !== HYPERLIQUID_SPOT_IOC_PROFILE || intent.schema !== 'priorseal.intent.v2' || intent.chainId !== 0 || intent.chainRef !== HYPERLIQUID_MAINNET_CHAIN_REF || intent.action !== HYPERLIQUID_SPOT_IOC_ACTION || !intent.hyperliquidOrder) throw new TypeError('intent is not a Hyperliquid spot IOC authorization')
  const account = address(intent.sender, 'intent.sender')
  if (intent.recipient !== account || intent.asset !== `hyperliquid:mainnet/spot:${intent.hyperliquidOrder.assetId}`) throw new TypeError('intent Hyperliquid account or asset is inconsistent')
  const order = intent.hyperliquidOrder
  const nonce = milliseconds(intent.nonce ?? '', 'intent.nonce')
  if (BigInt(nonce) >= BigInt(order.expiresAfter) || BigInt(order.expiresAfter) - BigInt(nonce) > BigInt(HYPERLIQUID_MAX_SPOT_IOC_LIFETIME_MS)) throw new TypeError('intent Hyperliquid expiry is unsafe')
  return {
    schema: 'priorseal.hyperliquid-spot-ioc-submission.v1', account, clientOrderId: cloid(order.clientOrderId), nonce,
    expiresAfter: milliseconds(order.expiresAfter, 'intent.hyperliquidOrder.expiresAfter'),
    action: { type: 'order', orders: [{ a: assetId(order.assetId), b: boolean(order.isBuy, 'intent.hyperliquidOrder.isBuy'), p: decimal(order.limitPrice, 'intent.hyperliquidOrder.limitPrice', false), s: decimal(order.size, 'intent.hyperliquidOrder.size', true), r: false, t: { limit: { tif: 'Ioc' } }, c: cloid(order.clientOrderId) }], grouping: 'na' },
  }
}

function assetId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 10_000 || Number(value) >= HYPERLIQUID_OUTCOME_ASSET_ID_MIN) throw new TypeError('assetId must be a Hyperliquid spot-pair asset id from 10000 through 99999999')
  return Number(value)
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`)
  return value
}

function decimal(value: unknown, field: string, positive: boolean): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) throw new TypeError(`${field} must be a non-negative decimal string with at most 18 decimals`)
  const [whole, fraction = ''] = value.split('.')
  const normalized = fraction.replace(/0+$/, '') ? `${whole}.${fraction.replace(/0+$/, '')}` : whole
  if (positive && compareDecimal(normalized, '0') <= 0) throw new TypeError(`${field} must be positive`)
  return normalized
}

function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.')
  const [rightWhole, rightFraction = ''] = right.split('.')
  const scale = Math.max(leftFraction.length, rightFraction.length)
  const factor = 10n ** BigInt(scale)
  const integer = (whole: string, fraction: string) => BigInt(whole) * factor + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0')
  const difference = integer(leftWhole, leftFraction) - integer(rightWhole, rightFraction)
  return difference === 0n ? 0 : difference < 0n ? -1 : 1
}

function cloid(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{32}$/.test(value)) throw new TypeError('clientOrderId must be a 16-byte 0x-prefixed cloid')
  return value.toLowerCase()
}

function milliseconds(value: unknown, field: string): number {
  const normalized = uintString(value as bigint | number | string, field)
  if (BigInt(normalized) < 1_000_000_000_000n || BigInt(normalized) > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError(`${field} must be a safe epoch-millisecond timestamp`)
  return Number(normalized)
}

function address(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError(`${field} must be a 20-byte EVM address`)
  return value.toLowerCase()
}

function identifier(value: unknown, field: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new TypeError(`${field} is invalid`)
}

function uintString(value: bigint | number | string, field: string): string {
  try {
    if (!['bigint', 'number', 'string'].includes(typeof value) || typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error()
    const normalized = BigInt(value)
    if (normalized < 0n) throw new Error()
    return normalized.toString(10)
  } catch {
    throw new TypeError(`${field} must be an unsigned integer`)
  }
}

function validateConstraints(constraints: Intent['constraints'] | undefined): void {
  if (!constraints) return
  if (constraints.maxGasUsed != null) throw new TypeError('Hyperliquid spot IOC intents do not support maxGasUsed')
  if (constraints.finalityRequirement === 'RPC_FINALIZED') throw new TypeError('Hyperliquid spot IOC intents support confirmed observation only')
  if (constraints.minConfirmations != null && (!Number.isSafeInteger(constraints.minConfirmations) || constraints.minConfirmations < 0 || constraints.minConfirmations > 1)) throw new TypeError('Hyperliquid spot IOC minConfirmations must be 0 or 1')
  if (constraints.maxToleratedReorgDepth != null && constraints.maxToleratedReorgDepth !== 0) throw new TypeError('Hyperliquid spot IOC maxToleratedReorgDepth must be 0')
}
