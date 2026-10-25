import { matchUniqueContextCommitment } from './context-commitment.js'
import {
  buildSolanaTransactionIntent,
  hashSolanaTransactionMessage,
  SOLANA_MAINNET_CAIP2,
  SOLANA_TRANSACTION_PROFILE,
  type SolanaTransactionIntentInput,
} from './solana-transaction.js'
import type { Authorization, ContextCommitment, Intent } from './types.js'

export const INSIGHT_SOLANA_LENDING_GUARD_NAMESPACE = 'insight.solana-lending-guard.v1' as const
export const INSIGHT_SOLANA_LENDING_GUARD_SCHEMA = 'insight.solana-lending-guard-decision.v1' as const
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const HEX32 = /^0x[0-9a-f]{64}$/i
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const VALID_FOR_SECONDS = 300

export type InsightSolanaLendingGuardDecision = {
  schema: typeof INSIGHT_SOLANA_LENDING_GUARD_SCHEMA
  guard: {
    schema: 'insight.solana-lending-guard.v1'; verdict: 'ALLOW' | 'CAUTION' | 'BLOCK'
    chainId: 0; chainRef: typeof SOLANA_MAINNET_CAIP2; protocolId: 'kamino-lend' | 'marginfi-v2'; action: 'supply' | 'borrow'
    market: { collateralSymbol: string; loanSymbol: string }
    exactAction: {
      protocolId: 'kamino-lend' | 'marginfi-v2'; action: 'supply' | 'borrow'; programId: string
      instructionDataHash: `0x${string}`; messageHash: `0x${string}`; amount: string; account: string
      marketId: string; reserveOrBank: string; positionAccount: string | null; assetMint: string | null
    } | null
    [key: string]: unknown
  }
  transaction: SolanaTransactionIntentInput['transaction']
  action: NonNullable<InsightSolanaLendingGuardDecision['guard']['exactAction']> | null
  decisionHash: `0x${string}`
  attestation: {
    schema: typeof INSIGHT_SOLANA_LENDING_GUARD_SCHEMA
    payload: { decisionHash: `0x${string}`; messageHash: `0x${string}`; account: string; protocolId: 'kamino-lend' | 'marginfi-v2'; action: 'supply' | 'borrow'; verdict: 0 | 1 | 2; issuedAt: number; validUntil: number; schemaVersion: 1 }
    signer: { algorithm: 'ed25519'; publicKey: string }
    signature: string
  } | null
}
export type InsightSolanaLendingGuardVerification = {
  valid: boolean; signatureValid: boolean; trusted: boolean; expired: boolean; reason: string
  decisionHash: string | null; attester: string | null; issuedAt: number | null; validUntil: number | null
}
export type SolanaLendingGuardVerificationOptions = { trustedPublicKey: string; now?: number; allowHistorical?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('Solana lending decision exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new TypeError('Solana lending decision is too large')
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    if (keys.length > 20_000 || keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new TypeError('Unsafe Solana lending decision JSON')
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
  }
  throw new TypeError('Solana lending decision is not canonical JSON')
}
function base58(value: string): Uint8Array {
  if (!value || ![...value].every((character) => BASE58.includes(character))) throw new TypeError('Invalid base58 value')
  let integer = 0n
  for (const character of value) integer = integer * 58n + BigInt(BASE58.indexOf(character))
  const bytes: number[] = []
  while (integer > 0n) { bytes.push(Number(integer & 0xffn)); integer >>= 8n }
  bytes.reverse()
  let zeros = 0
  while (value[zeros] === '1') zeros += 1
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes])
}
function uint(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 }
function verdictCode(value: InsightSolanaLendingGuardDecision['guard']['verdict']): 0 | 1 | 2 { return value === 'ALLOW' ? 0 : value === 'CAUTION' ? 1 : 2 }
function failed(reason: string, decisionHash: string | null = null): InsightSolanaLendingGuardVerification {
  return { valid: false, signatureValid: false, trusted: false, expired: false, reason, decisionHash, attester: null, issuedAt: null, validUntil: null }
}
function asDecision(value: unknown): InsightSolanaLendingGuardDecision | null {
  if (!isRecord(value) || value.schema !== INSIGHT_SOLANA_LENDING_GUARD_SCHEMA || !isRecord(value.guard) || !isRecord(value.transaction)) return null
  return value as unknown as InsightSolanaLendingGuardDecision
}
function unsignedDecision(value: InsightSolanaLendingGuardDecision) {
  return { schema: INSIGHT_SOLANA_LENDING_GUARD_SCHEMA, guard: value.guard, transaction: value.transaction, action: value.action }
}
async function sha256(value: string): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
async function ed25519Verify(publicKey: string, signature: string, message: string): Promise<boolean> {
  try {
    const rawKey = base58(publicKey); const rawSignature = base58(signature)
    if (rawKey.length !== 32 || rawSignature.length !== 64) return false
    const keyBytes = rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength) as ArrayBuffer
    const signatureBytes = rawSignature.buffer.slice(rawSignature.byteOffset, rawSignature.byteOffset + rawSignature.byteLength) as ArrayBuffer
    const messageBytes = new TextEncoder().encode(message)
    const messageBuffer = messageBytes.buffer.slice(messageBytes.byteOffset, messageBytes.byteOffset + messageBytes.byteLength) as ArrayBuffer
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify'])
    return crypto.subtle.verify({ name: 'Ed25519' }, key, signatureBytes, messageBuffer)
  } catch { return false }
}
function expectedAsset(decision: InsightSolanaLendingGuardDecision): string {
  const symbol = (decision.guard.action === 'supply' ? decision.guard.market.collateralSymbol : decision.guard.market.loanSymbol).trim().toUpperCase()
  if (symbol === 'SOL' || symbol === 'WSOL') return `${SOLANA_MAINNET_CAIP2}/slip44:501`
  if (symbol === 'USDC') return `${SOLANA_MAINNET_CAIP2}/spl:${USDC_MINT}`
  throw new TypeError('SOLANA_LENDING_GUARD_ASSET_NOT_REVIEWED')
}

export function solanaLendingGuardCommitment(decision: Pick<InsightSolanaLendingGuardDecision, 'decisionHash'>): ContextCommitment {
  if (!HEX32.test(decision.decisionHash)) throw new TypeError('SOLANA_LENDING_GUARD_DECISION_HASH_INVALID')
  return { namespace: INSIGHT_SOLANA_LENDING_GUARD_NAMESPACE, algorithm: 'sha256', digest: decision.decisionHash.toLowerCase() }
}

/** Verify Insight's Ed25519 decision against a caller-pinned attester key. */
export async function verifyInsightSolanaLendingGuardDecision(value: unknown, options: SolanaLendingGuardVerificationOptions): Promise<InsightSolanaLendingGuardVerification> {
  const decision = asDecision(value)
  if (!decision || !isRecord(decision.attestation) || !isRecord(decision.action) || !isRecord(decision.guard.exactAction)) return failed('MALFORMED')
  try {
    const action = decision.action
    const attestation = decision.attestation
    const payload = attestation.payload
    if (decision.guard.schema !== 'insight.solana-lending-guard.v1' || decision.guard.chainId !== 0 || decision.guard.chainRef !== SOLANA_MAINNET_CAIP2 || !['kamino-lend', 'marginfi-v2'].includes(decision.guard.protocolId) || !['supply', 'borrow'].includes(decision.guard.action) || decision.guard.verdict !== 'ALLOW' || canonicalJson(decision.guard.exactAction) !== canonicalJson(action)) return failed('MALFORMED')
    if (action.protocolId !== decision.guard.protocolId || action.action !== decision.guard.action || !HEX32.test(action.messageHash) || !HEX32.test(action.instructionDataHash) || !/^[1-9][0-9]*$/.test(action.amount) || !action.account || !action.marketId || !action.reserveOrBank || !(action.positionAccount === null || typeof action.positionAccount === 'string')) return failed('MALFORMED')
    const transactionHash = await hashSolanaTransactionMessage(decision.transaction)
    if (transactionHash.toLowerCase() !== action.messageHash.toLowerCase()) return failed('MESSAGE_HASH_MISMATCH')
    const expectedHash = await sha256(canonicalJson(unsignedDecision(decision)))
    if (expectedHash.toLowerCase() !== decision.decisionHash.toLowerCase()) return failed('DECISION_HASH_MISMATCH', expectedHash)
    const attester = isRecord(attestation.signer) && typeof attestation.signer.publicKey === 'string' ? attestation.signer.publicKey : null
    const issuedAt = uint(payload?.issuedAt) ? payload.issuedAt : null
    const validUntil = uint(payload?.validUntil) ? payload.validUntil : null
    const now = options.now ?? Math.floor(Date.now() / 1000)
    const expired = validUntil === null || validUntil < now
    const trusted = attester === options.trustedPublicKey
    if (!trusted) return { valid: false, signatureValid: false, trusted: false, expired, reason: 'UNTRUSTED_ATTESTER', decisionHash: expectedHash, attester, issuedAt, validUntil }
    if (attestation.schema !== INSIGHT_SOLANA_LENDING_GUARD_SCHEMA || attestation.signer?.algorithm !== 'ed25519' || !payload || payload.decisionHash?.toLowerCase() !== expectedHash.toLowerCase() || payload.messageHash?.toLowerCase() !== action.messageHash.toLowerCase() || payload.account !== action.account || payload.protocolId !== action.protocolId || payload.action !== action.action || payload.verdict !== verdictCode(decision.guard.verdict) || payload.schemaVersion !== 1 || !issuedAt || !validUntil || validUntil - issuedAt > VALID_FOR_SECONDS) return { valid: false, signatureValid: false, trusted: true, expired, reason: 'ATTESTED_SCOPE_MISMATCH', decisionHash: expectedHash, attester, issuedAt, validUntil }
    const signatureValid = await ed25519Verify(attester, attestation.signature, canonicalJson({ schema: attestation.schema, payload, signer: attestation.signer }))
    if (!signatureValid) return { valid: false, signatureValid: false, trusted: true, expired, reason: 'INVALID_SIGNATURE', decisionHash: expectedHash, attester, issuedAt, validUntil }
    if (expired && !options.allowHistorical) return { valid: false, signatureValid: true, trusted: true, expired: true, reason: 'EXPIRED', decisionHash: expectedHash, attester, issuedAt, validUntil }
    return { valid: true, signatureValid: true, trusted: true, expired, reason: 'OK', decisionHash: expectedHash, attester, issuedAt, validUntil }
  } catch { return failed('MALFORMED') }
}

function guardScope(intent: Intent, decision: InsightSolanaLendingGuardDecision, now: number): void {
  if (!decision.attestation || !decision.action) throw new TypeError('SOLANA_LENDING_GUARD_ATTESTATION_UNAVAILABLE')
  if (intent.executionProfile !== SOLANA_TRANSACTION_PROFILE || intent.chainId !== 0 || intent.chainRef !== SOLANA_MAINNET_CAIP2 || intent.action !== 'SOLANA_TRANSACTION' || intent.sender !== decision.action.account || intent.asset !== expectedAsset(decision) || intent.amount !== decision.action.amount || !intent.solanaTransaction || canonicalJson(intent.solanaTransaction) !== canonicalJson(decision.transaction)) throw new TypeError('SOLANA_LENDING_GUARD_INPUT_SCOPE_MISMATCH')
  if (intent.validUntil > decision.attestation.payload.validUntil || intent.validUntil < now) throw new TypeError('SOLANA_LENDING_GUARD_VALIDITY_MISMATCH')
  if (!matchUniqueContextCommitment(intent, solanaLendingGuardCommitment(decision)).matched) throw new TypeError('SOLANA_LENDING_GUARD_CONTEXT_COMMITMENT_MISMATCH')
}

/** Bind a verified ALLOW to the exact Solana message and a caller-pinned Insight key. */
export async function buildSolanaLendingGuardBoundIntent(input: SolanaTransactionIntentInput, decisionValue: unknown, options: SolanaLendingGuardVerificationOptions): Promise<Intent> {
  const decision = asDecision(structuredClone(decisionValue))
  if (!decision) throw new TypeError('SOLANA_LENDING_GUARD_MALFORMED')
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const verification = await verifyInsightSolanaLendingGuardDecision(decision, { ...options, now })
  if (!verification.valid || !decision.attestation || !decision.action) throw new TypeError(`SOLANA_LENDING_GUARD_BLOCKED:${verification.reason}`)
  if (input.contextCommitments?.some((entry) => entry.namespace.toLowerCase() === INSIGHT_SOLANA_LENDING_GUARD_NAMESPACE)) throw new TypeError('SOLANA_LENDING_GUARD_RESERVED_NAMESPACE')
  if (input.asset !== expectedAsset(decision) || String(input.amount) !== decision.action.amount || canonicalJson(input.transaction) !== canonicalJson(decision.transaction)) throw new TypeError('SOLANA_LENDING_GUARD_INPUT_SCOPE_MISMATCH')
  const intent = buildSolanaTransactionIntent({ ...input, validUntil: Math.min(input.validUntil, decision.attestation.payload.validUntil), contextCommitments: [...(input.contextCommitments ?? []), solanaLendingGuardCommitment(decision)] })
  guardScope(intent, decision, now)
  return intent
}

export async function verifySolanaLendingGuardAuthorizationBinding(authorization: Authorization | unknown, decisionValue: unknown, options: SolanaLendingGuardVerificationOptions): Promise<{ valid: boolean; reason: string }> {
  const decision = asDecision(decisionValue)
  if (!decision || !isRecord(authorization) || !isRecord(authorization.intent) || !Number.isSafeInteger(authorization.issuedAt) || !Number.isSafeInteger(authorization.expiresAt)) return { valid: false, reason: 'MALFORMED' }
  const verification = await verifyInsightSolanaLendingGuardDecision(decision, { ...options, now: Number(authorization.issuedAt), allowHistorical: true })
  if (!verification.valid || !decision.attestation) return { valid: false, reason: `INSIGHT_${verification.reason}` }
  try {
    guardScope(authorization.intent as Intent, decision, Number(authorization.issuedAt))
    if (Number(authorization.expiresAt) > decision.attestation.payload.validUntil) return { valid: false, reason: 'AUTHORIZATION_OUTLIVES_INSIGHT_DECISION' }
    return { valid: true, reason: 'OK' }
  } catch (error) { return { valid: false, reason: error instanceof Error ? error.message : 'BINDING_MISMATCH' } }
}
