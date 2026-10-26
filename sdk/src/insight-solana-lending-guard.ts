import { matchUniqueContextCommitment } from './context-commitment.js'
import {
  buildSolanaTransactionIntent,
  hashSolanaTransactionMessage,
  SOLANA_MAINNET_CAIP2,
  SOLANA_TRANSACTION_PROFILE,
  type SolanaTransactionIntentInput,
} from './solana-transaction.js'
import type { Authorization, ContextCommitment, Intent, SolanaTransactionMessage } from './types.js'

export const INSIGHT_SOLANA_LENDING_GUARD_NAMESPACE = 'insight.solana-lending-guard.v1' as const
export const INSIGHT_SOLANA_LENDING_GUARD_SCHEMA = 'insight.solana-lending-guard-decision.v1' as const

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const HASH = /^0x[0-9a-fA-F]{64}$/
const UINT = /^(?:0|[1-9][0-9]*)$/
const VALID_FOR_SECONDS = 300
const PROTOCOLS = ['kamino-lend', 'marginfi-v2', 'jupiter-lend-earn', 'save-lend', 'loopscale-vault'] as const
type Protocol = (typeof PROTOCOLS)[number]

export type SolanaLendingGuardVerificationOptions = {
  /** Pinned Insight Ed25519 public key, encoded as a 32-byte base58 Solana key. */
  trustedPublicKey: string
  now?: number
  allowHistorical?: boolean
}

type ExactAction = {
  protocolId: Protocol
  action: 'supply' | 'borrow'
  messageHash: `0x${string}`
  amount: string
  account: string
  assetMint: string | null
  [key: string]: unknown
}

export type InsightSolanaLendingGuardDecision = {
  schema: typeof INSIGHT_SOLANA_LENDING_GUARD_SCHEMA
  guard: {
    schema: 'insight.solana-lending-guard.v1'
    verdict: 'ALLOW' | 'CAUTION' | 'BLOCK'
    chainId: 0
    chainRef: typeof SOLANA_MAINNET_CAIP2
    protocolId: Protocol
    action: 'supply' | 'borrow'
    market: { collateralSymbol: string; loanSymbol: string }
    exactAction: ExactAction | null
    [key: string]: unknown
  }
  transaction: SolanaTransactionMessage
  action: ExactAction | null
  decisionHash: `0x${string}`
  attestation: {
    schema: typeof INSIGHT_SOLANA_LENDING_GUARD_SCHEMA
    payload: {
      decisionHash: `0x${string}`
      messageHash: `0x${string}`
      account: string
      protocolId: Protocol
      action: 'supply' | 'borrow'
      verdict: 0 | 1 | 2
      issuedAt: number
      validUntil: number
      schemaVersion: 1
    }
    signer: { algorithm: 'ed25519'; publicKey: string }
    signature: string
  } | null
}

export type InsightSolanaLendingGuardVerification = {
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
    return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(',')}]`
  }
  if (!isRecord(value)) throw new TypeError('Solana lending decision is not canonical JSON')
  const keys = Object.keys(value).sort()
  if (keys.length > 20_000 || keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) {
    throw new TypeError('Unsafe Solana lending decision JSON')
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

function verdictCode(value: unknown): 0 | 1 | 2 | null {
  return value === 'ALLOW' ? 0 : value === 'CAUTION' ? 1 : value === 'BLOCK' ? 2 : null
}

function asDecision(value: unknown): InsightSolanaLendingGuardDecision | null {
  if (!isRecord(value) || value.schema !== INSIGHT_SOLANA_LENDING_GUARD_SCHEMA || !isRecord(value.guard) || !isRecord(value.transaction)) return null
  return value as unknown as InsightSolanaLendingGuardDecision
}

function unsignedDecision(decision: InsightSolanaLendingGuardDecision) {
  return { schema: decision.schema, guard: decision.guard, transaction: decision.transaction, action: decision.action }
}

async function sha256(value: string): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

async function verifyEvidenceSignature(
  attestation: NonNullable<InsightSolanaLendingGuardDecision['attestation']>,
  trustedPublicKey: string,
): Promise<boolean> {
  if (attestation.signer.algorithm !== 'ed25519' || attestation.signer.publicKey !== trustedPublicKey) return false
  const publicKey = base58(trustedPublicKey)
  const signature = base58(attestation.signature)
  if (publicKey.length !== 32 || signature.length !== 64) return false
  const key = await crypto.subtle.importKey('raw', publicKey.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify'])
  const message = new TextEncoder().encode(canonicalJson({ schema: attestation.schema, payload: attestation.payload, signer: attestation.signer }))
  return crypto.subtle.verify({ name: 'Ed25519' }, key, signature.buffer as ArrayBuffer, message.buffer as ArrayBuffer)
}

function expectedAsset(decision: InsightSolanaLendingGuardDecision): string {
  const market = decision.guard.market
  const symbol = (decision.guard.action === 'supply' ? market.collateralSymbol : market.loanSymbol).trim().toUpperCase()
  if (symbol === 'SOL' || symbol === 'WSOL') return `${SOLANA_MAINNET_CAIP2}/slip44:501`
  if (!decision.action || !isPublicKey(decision.action.assetMint)) throw new TypeError('SOLANA_LENDING_GUARD_ASSET_NOT_REVIEWED')
  return solanaLendingGuardIntentAsset(decision.action.assetMint)
}

/** The opaque commitment carried by the exact Solana transaction authorization. */
export function solanaLendingGuardCommitment(decision: Pick<InsightSolanaLendingGuardDecision, 'decisionHash'>): ContextCommitment {
  if (!HASH.test(decision.decisionHash)) throw new TypeError('Solana lending decision hash must be 32-byte hex')
  return { namespace: INSIGHT_SOLANA_LENDING_GUARD_NAMESPACE, algorithm: 'sha256', digest: decision.decisionHash.toLowerCase() }
}

/** A CAIP-19 asset label tied to the exact SPL mint in the reviewed instruction. */
export function solanaLendingGuardIntentAsset(assetMint: string): string {
  if (!isPublicKey(assetMint)) throw new TypeError('Solana lending asset mint must be a public key')
  return `${SOLANA_MAINNET_CAIP2}/spl:${assetMint}`
}

/** Verify Insight's Ed25519 evidence, exact decoded action, and exact message. */
export async function verifyInsightSolanaLendingGuardDecision(
  value: unknown,
  options: SolanaLendingGuardVerificationOptions,
): Promise<InsightSolanaLendingGuardVerification> {
  const empty = { valid: false, signatureValid: false, trusted: false, expired: false, reason: 'MALFORMED', decisionHash: null, attester: null, issuedAt: null, validUntil: null } as const
  try {
    const decision = asDecision(value)
    if (!decision || !isRecord(decision.attestation) || !isRecord(decision.action) || !isRecord(decision.guard.exactAction) || !isRecord(decision.guard.market)) {
      return { ...empty, reason: 'MISSING_OR_MALFORMED_ATTESTATION' }
    }
    const { guard, transaction, action, attestation } = decision
    const data = attestation.payload
    const expectedVerdict = verdictCode(guard.verdict)
    if (
      guard.schema !== INSIGHT_SOLANA_LENDING_GUARD_NAMESPACE ||
      guard.verdict !== 'ALLOW' || guard.chainId !== 0 || guard.chainRef !== SOLANA_MAINNET_CAIP2 ||
      !PROTOCOLS.includes(guard.protocolId) || !['supply', 'borrow'].includes(guard.action) ||
      typeof guard.market.collateralSymbol !== 'string' || typeof guard.market.loanSymbol !== 'string' ||
      canonicalJson(guard.exactAction) !== canonicalJson(action) ||
      action.protocolId !== guard.protocolId || action.action !== guard.action ||
      !HASH.test(action.messageHash) || !UINT.test(action.amount) || !isPublicKey(action.account) ||
      action.account !== transaction.feePayer || !isPublicKey(action.assetMint) ||
      !HASH.test(decision.decisionHash) || attestation.schema !== INSIGHT_SOLANA_LENDING_GUARD_SCHEMA ||
      !isRecord(data) || !isRecord(attestation.signer) || attestation.signer.algorithm !== 'ed25519' ||
      !isPublicKey(attestation.signer.publicKey) || typeof attestation.signature !== 'string' ||
      data.decisionHash !== decision.decisionHash || data.messageHash !== action.messageHash ||
      data.account !== action.account || data.protocolId !== action.protocolId || data.action !== action.action ||
      data.verdict !== expectedVerdict || data.schemaVersion !== 1 ||
      !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.validUntil) ||
      data.validUntil - data.issuedAt !== VALID_FOR_SECONDS
    ) return { ...empty, reason: 'MALFORMED' }
    const messageHash = await hashSolanaTransactionMessage(transaction)
    if (messageHash.toLowerCase() !== action.messageHash.toLowerCase()) return { ...empty, reason: 'MESSAGE_HASH_MISMATCH', decisionHash: decision.decisionHash, attester: attestation.signer.publicKey, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const decisionHash = await sha256(canonicalJson(unsignedDecision(decision)))
    if (decisionHash.toLowerCase() !== decision.decisionHash.toLowerCase()) return { ...empty, reason: 'DECISION_HASH_MISMATCH', decisionHash, attester: attestation.signer.publicKey, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const signatureValid = await verifyEvidenceSignature(attestation, options.trustedPublicKey)
    if (!signatureValid) return { ...empty, reason: 'SIGNATURE_INVALID', decisionHash, attester: attestation.signer.publicKey, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const expired = data.validUntil <= (options.now ?? Math.floor(Date.now() / 1000))
    const valid = options.allowHistorical ? data.validUntil > data.issuedAt : !expired
    return { valid, signatureValid: true, trusted: true, expired, reason: valid ? 'OK' : 'EXPIRED', decisionHash, attester: attestation.signer.publicKey, issuedAt: data.issuedAt, validUntil: data.validUntil }
  } catch {
    return { ...empty, reason: 'VERIFICATION_ERROR' }
  }
}

function guardScope(intent: Intent, decision: InsightSolanaLendingGuardDecision, now: number): void {
  const action = decision.action
  const attestation = decision.attestation
  if (!action || !attestation || intent.executionProfile !== SOLANA_TRANSACTION_PROFILE || intent.chainId !== 0 || intent.chainRef !== SOLANA_MAINNET_CAIP2 || intent.action !== 'SOLANA_TRANSACTION' || intent.sender !== action.account || intent.asset !== expectedAsset(decision) || intent.amount !== action.amount || !intent.solanaTransaction || canonicalJson(intent.solanaTransaction) !== canonicalJson(decision.transaction) || intent.validUntil > attestation.payload.validUntil || intent.validUntil <= now) {
    throw new Error('SOLANA_LENDING_GUARD_CALL_SCOPE_MISMATCH')
  }
  if (!matchUniqueContextCommitment(intent, solanaLendingGuardCommitment(decision)).matched) throw new Error('SOLANA_LENDING_GUARD_CONTEXT_COMMITMENT_MISMATCH')
}

/** Build the sole PriorSeal Solana-message intent permitted by an Insight ALLOW. */
export async function buildSolanaLendingGuardBoundIntent(
  input: SolanaTransactionIntentInput,
  decisionValue: unknown,
  options: SolanaLendingGuardVerificationOptions,
): Promise<Intent> {
  const decision = asDecision(structuredClone(decisionValue))
  if (!decision || !decision.action) throw new TypeError('SOLANA_LENDING_GUARD_MALFORMED')
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const verification = await verifyInsightSolanaLendingGuardDecision(decision, { ...options, now })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') throw new TypeError(`SOLANA_LENDING_GUARD_BLOCKED:${verification.reason}`)
  if (input.contextCommitments?.some((entry) => entry.namespace.toLowerCase() === INSIGHT_SOLANA_LENDING_GUARD_NAMESPACE)) throw new TypeError('SOLANA_LENDING_GUARD_RESERVED_NAMESPACE')
  if (input.asset !== expectedAsset(decision) || String(input.amount) !== decision.action.amount || canonicalJson(input.transaction) !== canonicalJson(decision.transaction)) throw new TypeError('SOLANA_LENDING_GUARD_INPUT_SCOPE_MISMATCH')
  const intent = buildSolanaTransactionIntent({
    ...input,
    validUntil: Math.min(input.validUntil, decision.attestation.payload.validUntil),
    contextCommitments: [...(input.contextCommitments ?? []), solanaLendingGuardCommitment(decision)],
  })
  guardScope(intent, decision, now)
  return intent
}

/** Verify that an issued PriorSeal authorization remains within the Insight decision scope. */
export async function verifySolanaLendingGuardAuthorizationBinding(
  authorization: Authorization | unknown,
  decisionValue: unknown,
  options: SolanaLendingGuardVerificationOptions,
): Promise<{ valid: boolean; reason: string }> {
  const decision = asDecision(decisionValue)
  if (!decision || !isRecord(authorization) || !isRecord(authorization.intent) || !Number.isSafeInteger(authorization.issuedAt) || !Number.isSafeInteger(authorization.expiresAt)) return { valid: false, reason: 'MALFORMED' }
  const verification = await verifyInsightSolanaLendingGuardDecision(decision, { ...options, now: Number(authorization.issuedAt), allowHistorical: true })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') return { valid: false, reason: `INSIGHT_${verification.reason}` }
  try {
    guardScope(authorization.intent as Intent, decision, Number(authorization.issuedAt))
    if (Number(authorization.expiresAt) > decision.attestation.payload.validUntil) return { valid: false, reason: 'AUTHORIZATION_OUTLIVES_INSIGHT_DECISION' }
    return { valid: true, reason: 'OK' }
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : 'BINDING_MISMATCH' }
  }
}
