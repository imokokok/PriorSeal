/**
 * Consume Insight's Solana Swap Guard (Orca Whirlpool USDC/USDT, mainnet) on
 * the PriorSeal side: verify the Ed25519-signed ALLOW decision, bind exactly
 * one reviewed transaction message into a PriorSeal intent, and close the loop
 * against Insight's Ed25519 settlement evidence.
 *
 * The settlement's strongest claim is cryptographic and re-checked here with
 * no Insight dependency: Solana includes a transaction only under an Ed25519
 * fee-payer signature over the exact compiled message bytes, so verifying the
 * settlement's on-chain signature against the attested unsigned message proves
 * the executed transaction is the reviewed one.
 */

import { matchUniqueContextCommitment } from './context-commitment.js'
import {
  buildSolanaTransactionIntent,
  encodeSolanaTransactionMessageBytes,
  hashSolanaTransactionMessage,
  SOLANA_MAINNET_CAIP2,
  SOLANA_TRANSACTION_PROFILE,
  type SolanaTransactionIntentInput,
} from './solana-transaction.js'
import type { Authorization, ContextCommitment, Intent, SolanaTransactionMessage } from './types.js'

export const INSIGHT_SOLANA_SWAP_GUARD_NAMESPACE = 'insight.solana-swap-guard.v1' as const
export const INSIGHT_SOLANA_SWAP_GUARD_SCHEMA = 'insight.solana-swap-guard-decision.v1' as const
export const INSIGHT_SOLANA_SWAP_GUARD_SETTLEMENT_SCHEMA = 'insight.solana-swap-guard-settlement.v1' as const
export const SOLANA_SWAP_GUARD_PROFILE_ID = 'solana-orca-whirlpool-usdc-usdt-1' as const
export const SOLANA_SWAP_GUARD_VALID_FOR_SECONDS = 300 as const

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const HASH = /^0x[0-9a-fA-F]{64}$/
const UINT = /^(?:0|[1-9][0-9]*)$/
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
type Direction = 'usdc-to-usdt' | 'usdt-to-usdc'

export type InsightSolanaSwapGuardVerificationOptions = {
  /** Pinned Insight Ed25519 public key, encoded as a 32-byte base58 Solana key. */
  trustedPublicKey: string
  now?: number
  allowHistorical?: boolean
}

export type InsightSolanaSwapGuardDecision = {
  schema: typeof INSIGHT_SOLANA_SWAP_GUARD_SCHEMA
  guard: {
    schema: typeof INSIGHT_SOLANA_SWAP_GUARD_NAMESPACE
    verdict: 'ALLOW' | 'CAUTION' | 'BLOCK'
    profileId: typeof SOLANA_SWAP_GUARD_PROFILE_ID
    direction: Direction
    market: { exactSwap: { amountInRaw: string; minOutRaw: string }; [key: string]: unknown }
    exactAction: Record<string, unknown> | null
    [key: string]: unknown
  }
  transaction: SolanaTransactionMessage
  action: {
    messageHash: `0x${string}`
    account: string
    profileId: typeof SOLANA_SWAP_GUARD_PROFILE_ID
    direction: Direction
    amount: string
    [key: string]: unknown
  } | null
  decisionHash: `0x${string}`
  attestation: {
    schema: typeof INSIGHT_SOLANA_SWAP_GUARD_SCHEMA
    payload: {
      decisionHash: `0x${string}`
      messageHash: `0x${string}`
      account: string
      profileId: typeof SOLANA_SWAP_GUARD_PROFILE_ID
      direction: Direction
      verdict: 0 | 1 | 2
      issuedAt: number
      validUntil: number
      schemaVersion: 1
    }
    signer: { algorithm: 'ed25519'; publicKey: string }
    signature: string
  } | null
}

export type InsightSolanaSwapGuardVerification = {
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

export type InsightSolanaSwapGuardSettlementData = {
  decisionHash: string
  /** The on-chain transaction signature (base58), bound to the attested message. */
  signature: string
  taker: string
  profileId: typeof SOLANA_SWAP_GUARD_PROFILE_ID
  direction: Direction
  amountInRaw: string
  minOutRaw: string
  sourceAmountRaw: string | null
  destinationAmountRaw: string | null
  status: 'SETTLED' | 'REVERTED' | 'UNRECONCILED'
  reconciliation: string
  slot: number
  executedAt: number
  issuedAt: number
  schemaVersion: 1
}

export type InsightSolanaSwapGuardSettlement = {
  schema: typeof INSIGHT_SOLANA_SWAP_GUARD_SETTLEMENT_SCHEMA
  payload: InsightSolanaSwapGuardSettlementData
  signer: { algorithm: 'ed25519'; publicKey: string }
  signature: string
}

export type InsightSolanaSwapGuardSettlementVerification = {
  valid: boolean
  signatureValid: boolean
  trusted: boolean
  reason: string
  settlement: InsightSolanaSwapGuardSettlementData | null
  attester: string | null
  issuedAt: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('Solana swap decision exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new TypeError('Solana swap decision is too large')
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`
  }
  if (!isRecord(value)) throw new TypeError('Solana swap decision is not canonical JSON')
  const keys = Object.keys(value).sort()
  if (keys.length > 20_000 || keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) {
    throw new TypeError('Unsafe Solana swap decision JSON')
  }
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
}

function base58(value: string): Uint8Array {
  if (!value || ![...value].every((character) => BASE58.includes(character))) throw new TypeError('Invalid base58')
  let number = 0n
  for (const character of value) number = number * 58n + BigInt(BASE58.indexOf(character))
  const bytes: number[] = []
  while (number > 0n) { bytes.push(Number(number & 0xffn)); number >>= 8n }
  bytes.reverse()
  let zeroes = 0
  while (value[zeroes] === '1') zeroes += 1
  return Uint8Array.from([...new Array(zeroes).fill(0), ...bytes])
}

function isPublicKey(value: unknown): value is string {
  try { return typeof value === 'string' && base58(value).length === 32 } catch { return false }
}

async function sha256Hex(value: string): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

async function verifyEd25519(signatureBase58: string, message: Uint8Array, publicKeyBase58: string): Promise<boolean> {
  const publicKey = base58(publicKeyBase58)
  const signature = base58(signatureBase58)
  if (publicKey.length !== 32 || signature.length !== 64) return false
  const key = await crypto.subtle.importKey('raw', publicKey.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify({ name: 'Ed25519' }, key, signature.buffer as ArrayBuffer, message.buffer as ArrayBuffer)
}

/** Exact-key-set check mirroring Insight's SolanaSignedEvidence envelope. */
function evidenceEnvelope(value: unknown, schema: string): { schema: string; payload: Record<string, unknown>; signer: { algorithm: string; publicKey: string }; signature: string } | null {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'payload,schema,signature,signer') return null
  if (value.schema !== schema || !isRecord(value.payload) || !isRecord(value.signer)) return null
  if (Object.keys(value.signer).sort().join(',') !== 'algorithm,publicKey') return null
  if (value.signer.algorithm !== 'ed25519' || typeof value.signer.publicKey !== 'string' || typeof value.signature !== 'string') return null
  return value as unknown as { schema: string; payload: Record<string, unknown>; signer: { algorithm: 'ed25519'; publicKey: string }; signature: string }
}

function directionValid(value: unknown): value is Direction {
  return value === 'usdc-to-usdt' || value === 'usdt-to-usdc'
}

function verdictCode(value: unknown): 0 | 1 | 2 | null {
  return value === 'ALLOW' ? 0 : value === 'CAUTION' ? 1 : value === 'BLOCK' ? 2 : null
}

/** Verify Insight's Ed25519 ALLOW decision and re-derive its integrity hash. */
export async function verifyInsightSolanaSwapGuardDecision(
  value: unknown,
  options: InsightSolanaSwapGuardVerificationOptions,
): Promise<InsightSolanaSwapGuardVerification> {
  const empty = { valid: false, signatureValid: false, trusted: false, expired: false, reason: 'MALFORMED', decisionHash: null, attester: null, issuedAt: null, validUntil: null } as const
  try {
    if (!isRecord(value) || value.schema !== INSIGHT_SOLANA_SWAP_GUARD_SCHEMA || !isRecord(value.guard) || !isRecord(value.transaction)) return { ...empty }
    const { guard, transaction, action, attestation } = value as unknown as InsightSolanaSwapGuardDecision
    if (!isRecord(value.attestation) || !isRecord(value.action) || !isRecord(guard.exactAction) || !isRecord(guard.market) || !isRecord(guard.market.exactSwap)) {
      return { ...empty, reason: 'MISSING_OR_MALFORMED_ATTESTATION' }
    }
    if (guard.schema !== INSIGHT_SOLANA_SWAP_GUARD_NAMESPACE || guard.verdict !== 'ALLOW' ||
      guard.profileId !== SOLANA_SWAP_GUARD_PROFILE_ID || !directionValid(guard.direction) ||
      !UINT.test(guard.market.exactSwap.amountInRaw) || !UINT.test(guard.market.exactSwap.minOutRaw)) {
      return { ...empty, reason: 'MALFORMED' }
    }
    const swapAction = value.action as InsightSolanaSwapGuardDecision['action'] & Record<string, unknown>
    if (!HASH.test(swapAction.messageHash) || !isPublicKey(swapAction.account) ||
      swapAction.profileId !== SOLANA_SWAP_GUARD_PROFILE_ID || !directionValid(swapAction.direction) ||
      !UINT.test(swapAction.amount) || swapAction.account !== transaction.feePayer ||
      canonicalJson(guard.exactAction) !== canonicalJson(value.action)) {
      return { ...empty, reason: 'EXACT_ACTION_MISMATCH' }
    }
    const decisionHash = await sha256Hex(canonicalJson({ schema: INSIGHT_SOLANA_SWAP_GUARD_SCHEMA, guard: value.guard, transaction: value.transaction, action: value.action }))
    if (!HASH.test(value.decisionHash as string) || decisionHash.toLowerCase() !== String(value.decisionHash).toLowerCase()) {
      return { ...empty, reason: 'DECISION_HASH_MISMATCH', decisionHash }
    }
    // Independent message check: the attested message hash must equal the hash
    // of the exact serialized message bytes PriorSeal compiles itself.
    const messageHash = await hashSolanaTransactionMessage(transaction)
    if (messageHash.toLowerCase() !== swapAction.messageHash.toLowerCase()) return { ...empty, reason: 'MESSAGE_HASH_MISMATCH', decisionHash }
    const envelope = evidenceEnvelope(value.attestation, INSIGHT_SOLANA_SWAP_GUARD_SCHEMA)
    if (!envelope || !isPublicKey(envelope.signer.publicKey)) {
      return { ...empty, reason: 'MALFORMED', decisionHash }
    }
    const payload = envelope.payload as {
      decisionHash?: string
      messageHash?: string
      account?: string
      profileId?: string
      direction?: string
      verdict?: number
      issuedAt?: number
      validUntil?: number
      schemaVersion?: number
    }
    const issuedAt = typeof payload.issuedAt === 'number' ? payload.issuedAt : null
    const validUntil = typeof payload.validUntil === 'number' ? payload.validUntil : null
    const attester = envelope.signer.publicKey
    const trusted = envelope.signer.publicKey === options.trustedPublicKey
    if (!trusted) return { ...empty, reason: 'UNTRUSTED_ATTESTER', decisionHash, attester, issuedAt, validUntil }
    const signatureValid = await verifyEd25519(envelope.signature, new TextEncoder().encode(canonicalJson({ schema: envelope.schema, payload: envelope.payload, signer: envelope.signer })), attester)
    if (!signatureValid) return { ...empty, reason: 'SIGNATURE_INVALID', decisionHash, attester, issuedAt, validUntil }
    if (payload.decisionHash?.toLowerCase() !== decisionHash.toLowerCase() || payload.messageHash?.toLowerCase() !== swapAction.messageHash.toLowerCase() ||
      payload.account !== swapAction.account || payload.profileId !== swapAction.profileId ||
      payload.direction !== swapAction.direction || payload.verdict !== 0 || payload.schemaVersion !== 1 ||
      issuedAt === null || validUntil === null ||
      validUntil - issuedAt !== SOLANA_SWAP_GUARD_VALID_FOR_SECONDS) {
      return { ...empty, signatureValid: true, reason: 'ATTESTED_SCOPE_MISMATCH', decisionHash, attester, issuedAt, validUntil }
    }
    const expired = validUntil <= (options.now ?? Math.floor(Date.now() / 1000))
    const valid = options.allowHistorical ? validUntil > issuedAt : !expired
    return { valid, signatureValid: true, trusted: true, expired, reason: valid ? 'OK' : 'EXPIRED', decisionHash, attester, issuedAt, validUntil }
  } catch {
    return { ...empty, reason: 'VERIFICATION_ERROR' }
  }
}

/** The opaque commitment carried by the exact Solana transaction authorization. */
export function solanaSwapGuardCommitment(decision: Pick<InsightSolanaSwapGuardDecision, 'decisionHash'>): ContextCommitment {
  if (!HASH.test(decision.decisionHash)) throw new TypeError('Solana swap decision hash must be 32-byte hex')
  return { namespace: INSIGHT_SOLANA_SWAP_GUARD_NAMESPACE, algorithm: 'sha256', digest: decision.decisionHash.toLowerCase() }
}

/** CAIP-19 asset label for the reviewed input token of the guarded swap. */
export function solanaSwapGuardIntentAsset(direction: Direction): string {
  return `${SOLANA_MAINNET_CAIP2}/spl:${direction === 'usdc-to-usdt' ? USDC_MINT : USDT_MINT}`
}

function decisionShape(value: unknown): InsightSolanaSwapGuardDecision | null {
  if (!isRecord(value) || value.schema !== INSIGHT_SOLANA_SWAP_GUARD_SCHEMA || !isRecord(value.guard) || !isRecord(value.transaction)) return null
  return value as unknown as InsightSolanaSwapGuardDecision
}

/** Build the sole PriorSeal Solana-message intent permitted by an Insight swap ALLOW. */
export async function buildSolanaSwapGuardBoundIntent(
  input: SolanaTransactionIntentInput,
  decisionValue: unknown,
  options: InsightSolanaSwapGuardVerificationOptions,
): Promise<Intent> {
  const decision = decisionShape(structuredClone(decisionValue))
  if (!decision || !decision.action) throw new TypeError('SOLANA_SWAP_GUARD_MALFORMED')
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const verification = await verifyInsightSolanaSwapGuardDecision(decision, { ...options, now })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') throw new TypeError(`SOLANA_SWAP_GUARD_BLOCKED:${verification.reason}`)
  if (input.contextCommitments?.some((entry) => entry.namespace.toLowerCase() === INSIGHT_SOLANA_SWAP_GUARD_NAMESPACE)) throw new TypeError('SOLANA_SWAP_GUARD_RESERVED_NAMESPACE')
  if (input.asset !== solanaSwapGuardIntentAsset(decision.guard.direction) || String(input.amount) !== decision.action.amount ||
    canonicalJson(input.transaction) !== canonicalJson(decision.transaction)) throw new TypeError('SOLANA_SWAP_GUARD_INPUT_SCOPE_MISMATCH')
  const intent = buildSolanaTransactionIntent({
    ...input,
    validUntil: Math.min(input.validUntil, decision.attestation.payload.validUntil),
    contextCommitments: [...(input.contextCommitments ?? []), solanaSwapGuardCommitment(decision)],
  })
  const attestation = decision.attestation!
  if (intent.executionProfile !== SOLANA_TRANSACTION_PROFILE || intent.chainId !== 0 || intent.chainRef !== SOLANA_MAINNET_CAIP2 ||
    intent.action !== 'SOLANA_TRANSACTION' || intent.sender !== decision.action.account ||
    intent.asset !== solanaSwapGuardIntentAsset(decision.guard.direction) || intent.amount !== decision.action.amount ||
    canonicalJson(intent.solanaTransaction ?? {}) !== canonicalJson(decision.transaction) ||
    !Number.isSafeInteger(intent.validUntil) || intent.validUntil > attestation.payload.validUntil || intent.validUntil <= now) {
    throw new Error('SOLANA_SWAP_GUARD_INTENT_SCOPE_MISMATCH')
  }
  if (!matchUniqueContextCommitment(intent, solanaSwapGuardCommitment(decision)).matched) throw new Error('SOLANA_SWAP_GUARD_CONTEXT_COMMITMENT_MISMATCH')
  return intent
}

/** Verify that an issued PriorSeal authorization remains within the Insight swap decision scope. */
export async function verifySolanaSwapGuardAuthorizationBinding(
  authorization: Authorization | unknown,
  decisionValue: unknown,
  options: InsightSolanaSwapGuardVerificationOptions,
): Promise<{ valid: boolean; reason: string }> {
  const decision = decisionShape(decisionValue)
  if (!decision || !isRecord(authorization) || !isRecord(authorization.intent) || !Number.isSafeInteger(authorization.issuedAt) || !Number.isSafeInteger(authorization.expiresAt)) return { valid: false, reason: 'MALFORMED' }
  const verification = await verifyInsightSolanaSwapGuardDecision(decision, { ...options, now: Number(authorization.issuedAt), allowHistorical: true })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') return { valid: false, reason: `INSIGHT_${verification.reason}` }
  try {
    const intent = authorization.intent as Intent
    const now = Number(authorization.issuedAt)
    if (intent.executionProfile !== SOLANA_TRANSACTION_PROFILE || intent.chainId !== 0 || intent.chainRef !== SOLANA_MAINNET_CAIP2 ||
      intent.action !== 'SOLANA_TRANSACTION' || intent.sender !== decision.action!.account ||
      intent.asset !== solanaSwapGuardIntentAsset(decision.guard.direction) || intent.amount !== decision.action!.amount ||
      !intent.solanaTransaction || canonicalJson(intent.solanaTransaction) !== canonicalJson(decision.transaction) ||
      intent.validUntil > decision.attestation.payload.validUntil || intent.validUntil <= now) {
      throw new Error('SOLANA_SWAP_GUARD_CALL_SCOPE_MISMATCH')
    }
    if (!matchUniqueContextCommitment(intent, solanaSwapGuardCommitment(decision)).matched) throw new Error('SOLANA_SWAP_GUARD_CONTEXT_COMMITMENT_MISMATCH')
    if (Number(authorization.expiresAt) > decision.attestation.payload.validUntil) return { valid: false, reason: 'AUTHORIZATION_OUTLIVES_INSIGHT_DECISION' }
    return { valid: true, reason: 'OK' }
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : 'BINDING_MISMATCH' }
  }
}

/** Verify Insight's Ed25519 settlement evidence with a pinned signer key. */
export async function verifyInsightSolanaSwapGuardSettlement(value: unknown, options: { trustedPublicKey: string }): Promise<InsightSolanaSwapGuardSettlementVerification> {
  const failed = (reason: string): InsightSolanaSwapGuardSettlementVerification => ({ valid: false, signatureValid: false, trusted: false, reason, settlement: null, attester: null, issuedAt: null })
  try {
    const envelope = evidenceEnvelope(value, INSIGHT_SOLANA_SWAP_GUARD_SETTLEMENT_SCHEMA)
    if (!envelope) return failed('MALFORMED')
    const payload = envelope.payload as unknown as InsightSolanaSwapGuardSettlementData
    if (!isPublicKey(envelope.signer.publicKey) || !isRecord(payload)) return failed('MALFORMED')
    const attester = envelope.signer.publicKey
    if (
      !HASH.test(payload.decisionHash) || !/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(payload.signature) ||
      !isPublicKey(payload.taker) || payload.profileId !== SOLANA_SWAP_GUARD_PROFILE_ID ||
      !directionValid(payload.direction) || !UINT.test(payload.amountInRaw) || !UINT.test(payload.minOutRaw) ||
      !(payload.sourceAmountRaw === null || (typeof payload.sourceAmountRaw === 'string' && /^[0-9]+$/.test(payload.sourceAmountRaw))) ||
      !(payload.destinationAmountRaw === null || (typeof payload.destinationAmountRaw === 'string' && /^[0-9]+$/.test(payload.destinationAmountRaw))) ||
      !(payload.status === 'SETTLED' || payload.status === 'REVERTED' || payload.status === 'UNRECONCILED') ||
      typeof payload.reconciliation !== 'string' || !Number.isSafeInteger(payload.slot) || payload.slot < 0 ||
      !Number.isSafeInteger(payload.executedAt) || payload.executedAt <= 0 ||
      !Number.isSafeInteger(payload.issuedAt) || payload.issuedAt <= 0 || payload.schemaVersion !== 1
    ) return failed('MALFORMED')
    if (envelope.signer.publicKey !== options.trustedPublicKey) return { valid: false, signatureValid: false, trusted: false, reason: 'UNTRUSTED_ATTESTER', settlement: payload, attester, issuedAt: payload.issuedAt }
    const signatureValid = await verifyEd25519(envelope.signature, new TextEncoder().encode(canonicalJson({ schema: envelope.schema, payload: envelope.payload, signer: envelope.signer })), attester)
    if (!signatureValid) return { valid: false, signatureValid: false, trusted: true, reason: 'SIGNATURE_INVALID', settlement: payload, attester, issuedAt: payload.issuedAt }
    return { valid: true, signatureValid: true, trusted: true, reason: 'OK', settlement: payload, attester, issuedAt: payload.issuedAt }
  } catch {
    return failed('VERIFICATION_ERROR')
  }
}

export type InsightSolanaSwapGuardSettlementCrossCheck = {
  valid: boolean
  reason: string
  settlement: InsightSolanaSwapGuardSettlementData | null
  attester: string | null
}

/**
 * Close the loop: verify the settlement, cross-bind it to the decision it
 * claims to settle, and cryptographically confirm the executed transaction is
 * the reviewed one (Ed25519 fee-payer signature over the attested message).
 * The decision may have expired — closure is a historical fact.
 */
export async function verifySolanaSwapGuardSettlementForDecision(
  input: { settlement: unknown; decision: unknown },
  options: { trustedPublicKey: string },
): Promise<InsightSolanaSwapGuardSettlementCrossCheck> {
  const decision = decisionShape(input.decision)
  if (!decision || !decision.action || !decision.attestation) return { valid: false, reason: 'DECISION_MALFORMED', settlement: null, attester: null }
  const settlementVerification = await verifyInsightSolanaSwapGuardSettlement(input.settlement, options)
  if (!settlementVerification.valid || !settlementVerification.settlement) return { valid: false, reason: `SETTLEMENT_${settlementVerification.reason}`, settlement: settlementVerification.settlement, attester: settlementVerification.attester }
  const settlement = settlementVerification.settlement
  if (settlement.decisionHash.toLowerCase() !== decision.decisionHash.toLowerCase()) return { valid: false, reason: 'DECISION_HASH_MISMATCH', settlement, attester: settlementVerification.attester }
  if (settlement.profileId !== decision.guard.profileId || settlement.direction !== decision.guard.direction) return { valid: false, reason: 'SCOPE_MISMATCH', settlement, attester: settlementVerification.attester }
  if (settlement.amountInRaw !== decision.guard.market.exactSwap.amountInRaw || settlement.minOutRaw !== decision.guard.market.exactSwap.minOutRaw) return { valid: false, reason: 'AMOUNT_MISMATCH', settlement, attester: settlementVerification.attester }
  if (settlement.taker !== decision.action.account) return { valid: false, reason: 'TAKER_MISMATCH', settlement, attester: settlementVerification.attester }
  // The executed-message binding: the on-chain signature must verify over the
  // attested unsigned message bytes under the reviewed fee payer key.
  const executedMatch = await verifyEd25519(settlement.signature, encodeSolanaTransactionMessageBytes(decision.transaction), decision.transaction.feePayer)
  if (!executedMatch) return { valid: false, reason: 'EXECUTED_MESSAGE_MISMATCH', settlement, attester: settlementVerification.attester }
  return { valid: true, reason: 'OK', settlement, attester: settlementVerification.attester }
}

export type InsightSolanaSwapGuardSettlementContradiction = {
  decisionHash: string
  txSignatures: string[]
  attesters: string[]
  indices: number[]
}

export type InsightSolanaSwapGuardSettlementSetReport = {
  consistent: boolean
  verified: number
  unverified: Array<{ index: number; reason: string }>
  contradictions: InsightSolanaSwapGuardSettlementContradiction[]
}

/** Detect two verified settlements claiming the same decisionHash for different transactions. */
export async function detectSolanaSwapGuardSettlementContradictions(settlements: readonly unknown[], options: { trustedPublicKey: string }): Promise<InsightSolanaSwapGuardSettlementSetReport> {
  const report: InsightSolanaSwapGuardSettlementSetReport = { consistent: true, verified: 0, unverified: [], contradictions: [] }
  const byDecision = new Map<string, { index: number; txSignature: string; attester: string }[]>()
  for (const [index, candidate] of settlements.entries()) {
    const verification = await verifyInsightSolanaSwapGuardSettlement(candidate, options)
    if (!verification.valid || !verification.settlement) {
      report.unverified.push({ index, reason: verification.reason })
      continue
    }
    report.verified += 1
    const group = byDecision.get(verification.settlement.decisionHash.toLowerCase()) ?? []
    group.push({ index, txSignature: verification.settlement.signature, attester: verification.attester ?? '' })
    byDecision.set(verification.settlement.decisionHash.toLowerCase(), group)
  }
  for (const [decisionHash, group] of byDecision) {
    const distinctSignatures = [...new Set(group.map((entry) => entry.txSignature))]
    if (distinctSignatures.length > 1) {
      report.consistent = false
      report.contradictions.push({ decisionHash, txSignatures: distinctSignatures, attesters: [...new Set(group.map((entry) => entry.attester))], indices: group.map((entry) => entry.index) })
    }
  }
  return report
}
