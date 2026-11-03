/**
 * Consume Insight's Hyperliquid Perp Guard on the PriorSeal side.
 *
 * Hyperliquid orders are not EVM transactions: the caller signs a specialised
 * L1 action envelope in their own wallet process. Insight therefore signs risk
 * assessment evidence about an exact *unsigned* IOC order envelope, and this
 * module binds that signed assessment to a PriorSeal authorization for the
 * same envelope — one order, IOC-only, reduce-only forbidden, no field
 * substitution after assessment.
 *
 * PriorSeal never signs or submits the exchange action: the submission helper
 * emits the exact unsigned action the user-controlled wallet must sign with
 * Hyperliquid's official SDK.
 */

import { hashTypedData, keccak256, verifyTypedData } from 'viem'
import type { KeyRegistry } from 'verify-insight-receipt'

import { matchUniqueContextCommitment } from './context-commitment.js'
import { parseContextCommitments } from './exact-call.js'
import type { Authorization, ContextCommitment, Intent } from './types.js'
import { insightKeyRegistryTrust } from './insight-base-agent-swap-guard.js'

export const INSIGHT_HYPERLIQUID_PERP_GUARD_NAMESPACE = 'insight.hyperliquid-perp-guard.v1' as const
export const INSIGHT_HYPERLIQUID_PERP_GUARD_SCHEMA = 'insight.hyperliquid-perp-guard-decision.v1' as const
export const HYPERLIQUID_PERP_GUARD_PROTOCOL_ID = 'hyperliquid-perps-mainnet' as const
export const HYPERLIQUID_PERP_GUARD_VALID_FOR_SECONDS = 300 as const
export const HYPERLIQUID_PERP_IOC_PROFILE = 'priorseal.execution-profile.hyperliquid-perp-ioc.v1' as const
export const HYPERLIQUID_PERP_IOC_ACTION = 'HYPERLIQUID_PERP_IOC_ORDER' as const
/** Hyperliquid documents a 0.1% builder-fee ceiling for perps. */
export const HYPERLIQUID_MAX_PERP_BUILDER_FEE_TENTHS_BPS = 100 as const
/** Insight binds perp envelopes inside a reviewed 5–120 second expiry window. */
export const HYPERLIQUID_PERP_MAX_ENVELOPE_LIFETIME_MS = 120_000 as const
/** Perp coin asset indices sit below spot ids (≥10000) and outcome ids (≥100M). */
export const HYPERLIQUID_PERP_ASSET_INDEX_MAX = 9_999 as const

const DOMAIN = { name: 'Insight Hyperliquid Perp Guard', version: '1', chainId: 1 } as const
const TYPES = {
  HyperliquidPerpGuardDecision: [
    { name: 'decisionHash', type: 'bytes32' },
    { name: 'intentHash', type: 'bytes32' },
    { name: 'coin', type: 'string' },
    { name: 'assetIndex', type: 'uint256' },
    { name: 'size', type: 'string' },
    { name: 'isBuy', type: 'bool' },
    { name: 'builderFeeTenths', type: 'uint256' },
    { name: 'verdict', type: 'uint8' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'schemaVersion', type: 'uint256' },
  ],
} as const
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/
const CLOID = /^0x[0-9a-fA-F]{32}$/
const POSITIVE_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const COIN = /^[A-Za-z][A-Za-z0-9.-]{0,15}$/

export type HyperliquidPerpOrderEnvelope = {
  action: {
    type: 'order'
    orders: Array<{ a: number; b: boolean; p: string; s: string; r: false; t: { limit: { tif: 'Ioc' } }; c: string }>
    grouping: 'na'
    builder?: { b: string; f: number } | undefined
  }
  expiresAfter: number
}

export type HyperliquidPerpOrderBinding = {
  intentHash: `0x${string}`
  coin: string
  assetIndex: number
  isBuy: boolean
  size: string
  limitPrice: string
  reduceOnly: false
  expiresAfter: number
  impliedSizeUsd: number
  builder: { b: string; f: number } | null
}

export type InsightHyperliquidPerpGuardDecision = {
  schema: typeof INSIGHT_HYPERLIQUID_PERP_GUARD_SCHEMA
  guard: {
    schema: typeof INSIGHT_HYPERLIQUID_PERP_GUARD_NAMESPACE
    verdict: 'ALLOW' | 'CAUTION' | 'BLOCK'
    protocolId: typeof HYPERLIQUID_PERP_GUARD_PROTOCOL_ID
    action: 'open_long' | 'open_short'
    market: { assetSymbol: string; [key: string]: unknown }
    [key: string]: unknown
  }
  order: HyperliquidPerpOrderEnvelope
  binding: HyperliquidPerpOrderBinding
  decisionHash: `0x${string}`
  attestation: {
    type: 'HyperliquidPerpGuardDecision'
    schemaVersion: 1
    uid: `0x${string}`
    attester: string
    attesterLabel: 'Insight Hyperliquid Perp Guard attester'
    signedAt: string
    validForSeconds: number
    signature: `0x${string}`
    verifyUrl: string
    data: {
      decisionHash: `0x${string}`
      intentHash: `0x${string}`
      coin: string
      assetIndex: number
      size: string
      isBuy: boolean
      builderFeeTenths: number
      verdict: 0 | 1 | 2
      issuedAt: number
      validUntil: number
      schemaVersion: 1
    }
    eip712: Record<string, unknown>
  } | null
}

export type InsightHyperliquidPerpGuardVerification = {
  valid: boolean
  signatureValid: boolean
  trusted: boolean
  expired: boolean
  reason: string
  decisionHash: string | null
  attester: string | null
  issuedAt: number | null
  validUntil: number | null
}

export type InsightHyperliquidPerpGuardVerificationOptions = {
  keyRegistry?: KeyRegistry
  now?: number
  allowHistorical?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

/** Mirrors Insight canonical JSON so integrity hashes are independently reproducible. */
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('Hyperliquid perp decision exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new TypeError('Hyperliquid perp decision is too large')
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`
  }
  if (!isRecord(value)) throw new TypeError('Hyperliquid perp decision is not canonical JSON')
  const keys = Object.keys(value).sort()
  if (keys.length > 20_000 || keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) {
    throw new TypeError('Unsafe Hyperliquid perp decision JSON')
  }
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
}

function sameHash(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && HEX32.test(left) && HEX32.test(right) && left.toLowerCase() === right.toLowerCase()
}

function typedData(data: NonNullable<InsightHyperliquidPerpGuardDecision['attestation']>['data']) {
  return {
    domain: DOMAIN,
    types: TYPES,
    primaryType: 'HyperliquidPerpGuardDecision' as const,
    message: {
      decisionHash: data.decisionHash,
      intentHash: data.intentHash,
      coin: data.coin,
      assetIndex: BigInt(data.assetIndex),
      size: data.size,
      isBuy: data.isBuy,
      builderFeeTenths: BigInt(data.builderFeeTenths),
      verdict: data.verdict,
      issuedAt: BigInt(data.issuedAt),
      validUntil: BigInt(data.validUntil),
      schemaVersion: 1n,
    },
  } as const
}

/** Validate the strict unsigned envelope Insight reviewed. */
function envelopeShape(order: unknown): HyperliquidPerpOrderEnvelope | null {
  if (!isRecord(order) || !isRecord(order.action) || typeof order.expiresAfter !== 'number' ||
    !Number.isSafeInteger(order.expiresAfter) || order.expiresAfter < 0) return null
  const action = order.action as HyperliquidPerpOrderEnvelope['action']
  if (action.type !== 'order' || action.grouping !== 'na' || !Array.isArray(action.orders) || action.orders.length !== 1) return null
  const request = action.orders[0] as HyperliquidPerpOrderEnvelope['action']['orders'][number] | undefined
  if (!isRecord(request) || !Number.isSafeInteger(request.a) || request.a < 0 || request.a > HYPERLIQUID_PERP_ASSET_INDEX_MAX ||
    typeof request.b !== 'boolean' || typeof request.p !== 'string' || !POSITIVE_DECIMAL.test(request.p) ||
    typeof request.s !== 'string' || !POSITIVE_DECIMAL.test(request.s) || request.r !== false ||
    !isRecord(request.t) || !isRecord((request.t as { limit?: unknown }).limit) ||
    (request.t as { limit: { tif?: unknown } }).limit.tif !== 'Ioc' ||
    typeof request.c !== 'string' || !CLOID.test(request.c)) return null
  if (action.builder !== undefined) {
    if (!isRecord(action.builder) || typeof action.builder.b !== 'string' || !ADDRESS.test(action.builder.b) ||
      !Number.isSafeInteger(action.builder.f) || action.builder.f < 1 || action.builder.f > HYPERLIQUID_MAX_PERP_BUILDER_FEE_TENTHS_BPS) return null
  }
  return order as unknown as HyperliquidPerpOrderEnvelope
}

/** Re-derive the binding from the envelope exactly as Insight's binder does. */
function deriveBinding(guard: InsightHyperliquidPerpGuardDecision['guard'], order: HyperliquidPerpOrderEnvelope): HyperliquidPerpOrderBinding | null {
  const request = order.action.orders[0]!
  const coin = guard.market?.assetSymbol
  if (typeof coin !== 'string' || !COIN.test(coin)) return null
  const impliedSizeUsd = Number(request.s) * Number(request.p)
  if (!Number.isFinite(impliedSizeUsd) || impliedSizeUsd <= 0) return null
  let intentHash: `0x${string}`
  try {
    intentHash = keccak256(new TextEncoder().encode(canonicalJson(order)))
  } catch {
    return null
  }
  return {
    intentHash,
    coin,
    assetIndex: request.a,
    isBuy: request.b,
    size: request.s,
    limitPrice: request.p,
    reduceOnly: false,
    expiresAfter: order.expiresAfter,
    impliedSizeUsd,
    builder: order.action.builder ? { ...order.action.builder } : null,
  }
}

/**
 * Independently verify Insight's signed perp assessment: strict envelope and
 * binding re-derivation, decision integrity hash, EIP-712 attester signature,
 * key-registry trust, and both the attestation and envelope expiry windows.
 */
export async function verifyInsightHyperliquidPerpGuardDecision(value: unknown, options: InsightHyperliquidPerpGuardVerificationOptions = {}): Promise<InsightHyperliquidPerpGuardVerification> {
  const empty = { valid: false, signatureValid: false, trusted: false, expired: false, reason: 'MALFORMED', decisionHash: null, attester: null, issuedAt: null, validUntil: null } as const
  try {
    if (!isRecord(value) || value.schema !== INSIGHT_HYPERLIQUID_PERP_GUARD_SCHEMA || !isRecord(value.guard) || !isRecord(value.order) || !isRecord(value.binding)) return { ...empty }
    const decision = value as unknown as InsightHyperliquidPerpGuardDecision
    const { guard, binding } = decision
    if (guard.schema !== INSIGHT_HYPERLIQUID_PERP_GUARD_NAMESPACE || guard.protocolId !== HYPERLIQUID_PERP_GUARD_PROTOCOL_ID ||
      !['ALLOW', 'CAUTION', 'BLOCK'].includes(guard.verdict) || !['open_long', 'open_short'].includes(guard.action)) {
      return { ...empty }
    }
    const order = envelopeShape(value.order)
    if (!order) return { ...empty, reason: 'ENVELOPE_MALFORMED' }
    const expectedBinding = deriveBinding(guard, order)
    if (!expectedBinding || canonicalJson(expectedBinding) !== canonicalJson(value.binding)) return { ...empty, reason: 'BINDING_MISMATCH' }
    const expectedHash = keccak256(new TextEncoder().encode(canonicalJson({ schema: INSIGHT_HYPERLIQUID_PERP_GUARD_SCHEMA, guard: value.guard, order: value.order, binding: value.binding })))
    if (!sameHash(expectedHash, decision.decisionHash)) return { ...empty, reason: 'DECISION_HASH_MISMATCH', decisionHash: expectedHash }
    const attestation = decision.attestation
    if (!isRecord(value.attestation) || !attestation) return { ...empty, reason: 'MISSING_ATTESTATION', decisionHash: expectedHash }
    const data = attestation.data
    if (!isRecord(data) || attestation.type !== 'HyperliquidPerpGuardDecision' || attestation.schemaVersion !== 1 ||
      attestation.attesterLabel !== 'Insight Hyperliquid Perp Guard attester' || typeof attestation.verifyUrl !== 'string' ||
      !HEX32.test(attestation.uid) || !ADDRESS.test(attestation.attester) || !SIGNATURE.test(attestation.signature) ||
      !HEX32.test(data.decisionHash) || !HEX32.test(data.intentHash) || typeof data.coin !== 'string' || data.coin !== expectedBinding.coin ||
      !Number.isSafeInteger(data.assetIndex) || data.assetIndex !== expectedBinding.assetIndex ||
      data.size !== expectedBinding.size || data.isBuy !== expectedBinding.isBuy ||
      data.builderFeeTenths !== (expectedBinding.builder?.f ?? 0) || !Number.isSafeInteger(data.verdict) ||
      data.verdict !== (guard.verdict === 'ALLOW' ? 0 : guard.verdict === 'CAUTION' ? 1 : 2) ||
      !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.validUntil) ||
      data.validUntil - data.issuedAt !== HYPERLIQUID_PERP_GUARD_VALID_FOR_SECONDS || data.schemaVersion !== 1 ||
      attestation.signedAt !== new Date(data.issuedAt * 1000).toISOString() ||
      canonicalJson(attestation.eip712) !== canonicalJson({ domain: DOMAIN, types: TYPES, primaryType: 'HyperliquidPerpGuardDecision' })) {
      return { ...empty, reason: 'MALFORMED', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt ?? null, validUntil: data.validUntil ?? null }
    }
    if (!sameHash(data.intentHash, expectedBinding.intentHash) || !sameHash(data.decisionHash, expectedHash)) {
      return { ...empty, reason: 'BINDING_MISMATCH', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    }
    const args = typedData(data)
    if (!sameHash(hashTypedData(args), attestation.uid)) return { ...empty, reason: 'UID_MISMATCH', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const signatureValid = await verifyTypedData({ ...args, address: attestation.attester as `0x${string}`, signature: attestation.signature })
    if (!signatureValid) return { ...empty, reason: 'SIGNATURE_INVALID', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const trusted = insightKeyRegistryTrust(options.keyRegistry, attestation.attester, data.issuedAt)
    if (!trusted) return { ...empty, signatureValid: true, reason: 'SIGNER_UNTRUSTED', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const now = options.now ?? Math.floor(Date.now() / 1000)
    const expired = data.validUntil <= now || order.expiresAfter <= now * 1000
    const valid = options.allowHistorical ? data.validUntil > data.issuedAt : !expired
    return { valid, signatureValid: true, trusted: true, expired, reason: valid ? 'OK' : 'EXPIRED', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
  } catch {
    return { ...empty, reason: 'VERIFICATION_ERROR' }
  }
}

/** The opaque commitment carried by the perp IOC authorization intent. */
export function hyperliquidPerpGuardCommitment(decision: Pick<InsightHyperliquidPerpGuardDecision, 'decisionHash'>): ContextCommitment {
  if (!HEX32.test(decision.decisionHash)) throw new TypeError('Hyperliquid perp decision hash must be 32-byte hex')
  return { namespace: INSIGHT_HYPERLIQUID_PERP_GUARD_NAMESPACE, algorithm: 'keccak256', digest: decision.decisionHash.toLowerCase() }
}

export type HyperliquidPerpGuardIntentInput = {
  intentId: string
  /** Hyperliquid main account. The wallet that will sign the L1 action. */
  account: string
  /** PriorSeal policy counter in unsigned atomic units. */
  amount: bigint | number | string
  /** Hyperliquid action nonce in epoch milliseconds. */
  nonce: bigint | number | string
  /** PriorSeal validity in Unix seconds; it cannot outlive the envelope. */
  validUntil: number
  contextCommitments?: ContextCommitment[]
  constraints?: Intent['constraints']
}

function uintString(value: bigint | number | string, field: string): string {
  try {
    if (!['bigint', 'number', 'string'].includes(typeof value) || (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))) throw new Error()
    const normalized = BigInt(value)
    if (normalized < 0n) throw new Error()
    return normalized.toString(10)
  } catch {
    throw new TypeError(`${field} must be an unsigned integer`)
  }
}

function identifier(value: unknown, field: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new TypeError(`${field} is invalid`)
}

function address(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new TypeError(`${field} must be a 20-byte EVM address`)
  return value.toLowerCase()
}

/**
 * Create the only perp authorization PriorSeal permits from an Insight ALLOW:
 * an intent carrying the exact reviewed IOC envelope and the decision
 * commitment. Builder-fee envelopes are intentionally rejected here — the
 * intent schema does not carry a builder fee yet, and silently dropping one
 * would authorize more than Insight reviewed.
 */
export async function buildHyperliquidPerpGuardBoundIntent(input: HyperliquidPerpGuardIntentInput, decisionValue: unknown, options: InsightHyperliquidPerpGuardVerificationOptions = {}): Promise<Intent> {
  identifier(input.intentId, 'intentId')
  const account = address(input.account, 'account')
  const decision = structuredClone(decisionValue)
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const verification = await verifyInsightHyperliquidPerpGuardDecision(decision, { ...options, now })
  const shaped = decision as InsightHyperliquidPerpGuardDecision
  if (!verification.valid || !shaped?.attestation || shaped.guard.verdict !== 'ALLOW') throw new TypeError(`HYPERLIQUID_PERP_GUARD_BLOCKED:${verification.reason}`)
  const envelope = shaped.order
  if (envelope.action.builder) throw new TypeError('HYPERLIQUID_PERP_GUARD_BUILDER_FEE_NOT_SUPPORTED')
  if (input.contextCommitments?.some((entry) => entry.namespace.toLowerCase() === INSIGHT_HYPERLIQUID_PERP_GUARD_NAMESPACE)) throw new TypeError('HYPERLIQUID_PERP_GUARD_RESERVED_NAMESPACE')
  if (input.constraints?.maxGasUsed != null) throw new TypeError('Hyperliquid perp IOC intents do not support maxGasUsed')
  if (input.constraints?.finalityRequirement === 'RPC_FINALIZED') throw new TypeError('Hyperliquid perp IOC intents support confirmed observation only')
  const nonce = uintString(input.nonce, 'nonce')
  const expiresAfter = envelope.expiresAfter
  if (BigInt(nonce) >= BigInt(expiresAfter)) throw new TypeError('nonce must be earlier than the reviewed envelope expiry')
  if (BigInt(expiresAfter) - BigInt(nonce) > BigInt(HYPERLIQUID_PERP_MAX_ENVELOPE_LIFETIME_MS)) throw new TypeError(`nonce must be within ${HYPERLIQUID_PERP_MAX_ENVELOPE_LIFETIME_MS}ms of the reviewed envelope expiry`)
  const request = envelope.action.orders[0]!
  const attestationValidUntil = shaped.attestation.data.validUntil
  const validUntil = Math.min(input.validUntil, attestationValidUntil, Math.floor(expiresAfter / 1000))
  if (!Number.isSafeInteger(validUntil) || validUntil <= now) throw new TypeError('validUntil must be a future Unix second within the attestation and envelope windows')
  const amount = uintString(input.amount, 'amount')
  const commitment = hyperliquidPerpGuardCommitment(shaped)
  const intent: Intent = {
    schema: 'priorseal.intent.v2',
    executionProfile: HYPERLIQUID_PERP_IOC_PROFILE,
    intentId: input.intentId,
    chainId: 0,
    chainRef: 'hyperliquid:mainnet',
    action: HYPERLIQUID_PERP_IOC_ACTION,
    asset: `hyperliquid:mainnet/perp:${request.a}`,
    amount,
    sender: account,
    recipient: account,
    validUntil,
    nonce,
    hyperliquidOrder: {
      assetId: request.a,
      isBuy: request.b,
      limitPrice: request.p,
      size: request.s,
      timeInForce: 'Ioc',
      clientOrderId: request.c,
      expiresAfter,
    },
    contextCommitments: parseContextCommitments([...(input.contextCommitments ?? []), commitment]),
    ...(input.constraints ? { constraints: input.constraints } : {}),
  }
  if (!matchUniqueContextCommitment(intent, commitment).matched) throw new TypeError('HYPERLIQUID_PERP_GUARD_CONTEXT_COMMITMENT_MISMATCH')
  return intent
}

/** Verify an issued authorization retains the exact reviewed perp envelope. */
export async function verifyHyperliquidPerpGuardAuthorizationBinding(authorization: Authorization | unknown, decisionValue: unknown, options: InsightHyperliquidPerpGuardVerificationOptions = {}): Promise<{ valid: boolean; reason: string }> {
  const decision = decisionValue as InsightHyperliquidPerpGuardDecision
  if (!isRecord(decision) || decision.schema !== INSIGHT_HYPERLIQUID_PERP_GUARD_SCHEMA || !isRecord(authorization) ||
    !isRecord(authorization.intent) || !Number.isSafeInteger(authorization.issuedAt) || !Number.isSafeInteger(authorization.expiresAt)) return { valid: false, reason: 'MALFORMED' }
  const issuedAt = Number(authorization.issuedAt)
  const verification = await verifyInsightHyperliquidPerpGuardDecision(decision, { ...options, now: issuedAt, allowHistorical: true })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') return { valid: false, reason: `INSIGHT_${verification.reason}` }
  if (decision.order.action.builder) return { valid: false, reason: 'HYPERLIQUID_PERP_GUARD_BUILDER_FEE_NOT_SUPPORTED' }
  try {
    const intent = authorization.intent as Intent
    const order = decision.order
    const request = order.action.orders[0]!
    if (intent.schema !== 'priorseal.intent.v2' || intent.executionProfile !== HYPERLIQUID_PERP_IOC_PROFILE ||
      intent.action !== HYPERLIQUID_PERP_IOC_ACTION || intent.chainId !== 0 || intent.chainRef !== 'hyperliquid:mainnet' ||
      intent.asset !== `hyperliquid:mainnet/perp:${request.a}` || intent.sender !== intent.recipient ||
      !isRecord(intent.hyperliquidOrder)) throw new Error('HYPERLIQUID_PERP_GUARD_CALL_SCOPE_MISMATCH')
    const hyperliquidOrder = intent.hyperliquidOrder as NonNullable<Intent['hyperliquidOrder']>
    if (canonicalJson(hyperliquidOrder) !== canonicalJson({
      assetId: request.a,
      isBuy: request.b,
      limitPrice: request.p,
      size: request.s,
      timeInForce: 'Ioc',
      clientOrderId: request.c,
      expiresAfter: order.expiresAfter,
    })) throw new Error('HYPERLIQUID_PERP_GUARD_CALL_SCOPE_MISMATCH')
    if (intent.validUntil > decision.attestation.data.validUntil || intent.validUntil <= issuedAt) throw new Error('HYPERLIQUID_PERP_GUARD_CALL_SCOPE_MISMATCH')
    if (!matchUniqueContextCommitment(intent, hyperliquidPerpGuardCommitment(decision)).matched) throw new Error('HYPERLIQUID_PERP_GUARD_CONTEXT_COMMITMENT_MISMATCH')
    if (Number(authorization.expiresAt) > decision.attestation.data.validUntil) return { valid: false, reason: 'AUTHORIZATION_OUTLIVES_INSIGHT_DECISION' }
    return { valid: true, reason: 'OK' }
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : 'BINDING_MISMATCH' }
  }
}

export type HyperliquidPerpIocSubmission = {
  schema: 'priorseal.hyperliquid-perp-ioc-submission.v1'
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
 * Serialize the signed PriorSeal intent into the exact unsigned exchange
 * action for the user-controlled wallet to sign and submit with Hyperliquid's
 * official SDK. The signature, nonce signing and transport are deliberately
 * out of scope: PriorSeal observes, it never trades.
 */
export function buildHyperliquidPerpGuardSubmission(intent: Intent): HyperliquidPerpIocSubmission {
  if (intent.schema !== 'priorseal.intent.v2' || intent.executionProfile !== HYPERLIQUID_PERP_IOC_PROFILE ||
    intent.action !== HYPERLIQUID_PERP_IOC_ACTION || intent.chainId !== 0 || intent.chainRef !== 'hyperliquid:mainnet' ||
    !isRecord(intent.hyperliquidOrder)) throw new TypeError('intent is not a Hyperliquid perp IOC authorization')
  const account = address(intent.sender, 'intent.sender')
  if (intent.recipient !== account) throw new TypeError('intent Hyperliquid account is inconsistent')
  const order = intent.hyperliquidOrder as NonNullable<Intent['hyperliquidOrder']>
  if (typeof order.clientOrderId !== 'string' || !CLOID.test(order.clientOrderId) || typeof order.expiresAfter !== 'number') {
    throw new TypeError('intent Hyperliquid envelope is malformed')
  }
  if (BigInt(intent.nonce ?? '') >= BigInt(order.expiresAfter)) throw new TypeError('intent Hyperliquid expiry is unsafe')
  return {
    schema: 'priorseal.hyperliquid-perp-ioc-submission.v1',
    account,
    clientOrderId: order.clientOrderId.toLowerCase(),
    nonce: Number(intent.nonce),
    expiresAfter: order.expiresAfter,
    action: {
      type: 'order',
      orders: [{ a: order.assetId, b: order.isBuy, p: order.limitPrice, s: order.size, r: false, t: { limit: { tif: 'Ioc' } }, c: order.clientOrderId.toLowerCase() }],
      grouping: 'na',
    },
  }
}
