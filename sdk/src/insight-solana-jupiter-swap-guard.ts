import { matchUniqueContextCommitment } from './context-commitment.js'
import { buildSolanaTransactionIntent, SOLANA_MAINNET_CAIP2, SOLANA_TRANSACTION_PROFILE, type SolanaTransactionIntentInput } from './solana-transaction.js'
import type { Authorization, ContextCommitment, Intent } from './types.js'

export const INSIGHT_SOLANA_JUPITER_SWAP_GUARD_NAMESPACE = 'insight.solana-jupiter-swap-guard.v1' as const
export const INSIGHT_SOLANA_JUPITER_SWAP_GUARD_SCHEMA = 'insight.solana-jupiter-swap-guard.v1' as const
export const INSIGHT_SOLANA_JUPITER_SWAP_SCHEMA = 'insight.solana-jupiter-swap.v1' as const

const HASH = /^0x[0-9a-fA-F]{64}$/
const UINT = /^(?:0|[1-9][0-9]*)$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

type JupiterRiskVerdictRef = {
  source: 'solana_jupiter_swap_guard'
  schema: typeof INSIGHT_SOLANA_JUPITER_SWAP_GUARD_SCHEMA
  ruleSetVersion: string
  verdict: 'PASS' | 'CAUTION' | 'BLOCK'
  status: 'decided' | 'unavailable'
  productOutcome: 'approved' | 'rejected' | 'unavailable'
  evaluatedAt: string
  quoteDigest: `0x${string}` | null
  reasonsDigest: `0x${string}`
  reasons: string[]
}

export type InsightSolanaJupiterSwapGuardResult = {
  venue: 'solana_jupiter'
  state: 'READY'
  guard: {
    verdict: 'PASS'
    product_outcome: 'approved'
    executable: true
    reasons: string[]
    risk_verdict_ref: JupiterRiskVerdictRef
  }
  swap: {
    schema: typeof INSIGHT_SOLANA_JUPITER_SWAP_SCHEMA
    venue: 'jupiter'
    network: typeof SOLANA_MAINNET_CAIP2
    chainId: 0
    direction: { mode: 'exact-in'; inputMint: string; outputMint: string }
    quote: {
      inputMint: string
      outputMint: string
      amountInRaw: string
      minimumOutRaw: string
      [key: string]: unknown
    } | null
    transaction: { base64: string; lastValidBlockHeight: number; signatureRequired: 'user' } | null
    riskVerdictRef: JupiterRiskVerdictRef
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type InsightSolanaJupiterSwapGuardVerification = {
  valid: boolean
  reason: string
  quoteDigest: string | null
  inputMint: string | null
  outputMint: string | null
  amountInRaw: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPublicKey(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_KEY.test(value)
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('Jupiter guard result exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(',')}]`
  if (!isRecord(value)) throw new TypeError('Jupiter guard result is not canonical JSON')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Jupiter guard result has an invalid object prototype')
  if (Object.keys(value).some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')) throw new TypeError('Jupiter guard result contains a dangerous object key')
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
}

function riskRef(value: unknown): JupiterRiskVerdictRef | null {
  if (!isRecord(value) || value.source !== 'solana_jupiter_swap_guard' || value.schema !== INSIGHT_SOLANA_JUPITER_SWAP_GUARD_SCHEMA || value.verdict !== 'PASS' || value.status !== 'decided' || value.productOutcome !== 'approved' || typeof value.ruleSetVersion !== 'string' || typeof value.evaluatedAt !== 'string' || !HASH.test(String(value.quoteDigest ?? '')) || !HASH.test(String(value.reasonsDigest ?? '')) || !Array.isArray(value.reasons) || !value.reasons.every((reason) => typeof reason === 'string')) return null
  return value as unknown as JupiterRiskVerdictRef
}

function decisionShape(value: unknown): InsightSolanaJupiterSwapGuardResult | null {
  if (!isRecord(value) || value.venue !== 'solana_jupiter' || value.state !== 'READY' || !isRecord(value.guard) || !isRecord(value.swap)) return null
  const guard = value.guard
  const swap = value.swap
  if (guard.verdict !== 'PASS' || guard.product_outcome !== 'approved' || guard.executable !== true || !Array.isArray(guard.reasons) || !guard.reasons.every((reason) => typeof reason === 'string') || swap.schema !== INSIGHT_SOLANA_JUPITER_SWAP_SCHEMA || swap.venue !== 'jupiter' || swap.network !== SOLANA_MAINNET_CAIP2 || swap.chainId !== 0 || !isRecord(swap.direction) || swap.direction.mode !== 'exact-in' || !isPublicKey(swap.direction.inputMint) || !isPublicKey(swap.direction.outputMint) || !isRecord(swap.quote) || !UINT.test(String(swap.quote.amountInRaw)) || !UINT.test(String(swap.quote.minimumOutRaw)) || swap.quote.inputMint !== swap.direction.inputMint || swap.quote.outputMint !== swap.direction.outputMint || !isRecord(swap.transaction)) return null
  const transaction = swap.transaction
  const base64 = transaction.base64
  const lastValidBlockHeight = transaction.lastValidBlockHeight
  if (typeof base64 !== 'string' || base64.length < 8 || base64.length > 2_000_000 || !BASE64.test(base64) || typeof lastValidBlockHeight !== 'number' || !Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 0 || transaction.signatureRequired !== 'user') return null
  const guardRef = riskRef(guard.risk_verdict_ref)
  const swapRef = riskRef(swap.riskVerdictRef)
  if (!guardRef || !swapRef || canonicalJson(guardRef) !== canonicalJson(swapRef) || canonicalJson(guard.reasons) !== canonicalJson(guardRef.reasons) || guardRef.quoteDigest === null) return null
  return value as unknown as InsightSolanaJupiterSwapGuardResult
}

/** Bind the reviewed Jupiter quote digest to an exact compiled Solana message. */
export function solanaJupiterSwapGuardCommitment(decision: Pick<InsightSolanaJupiterSwapGuardResult, 'guard'>): ContextCommitment {
  const reference = riskRef(decision.guard.risk_verdict_ref)
  if (!reference || reference.quoteDigest === null) throw new TypeError('Jupiter guard result has no quote digest')
  return { namespace: INSIGHT_SOLANA_JUPITER_SWAP_GUARD_NAMESPACE, algorithm: 'sha256', digest: reference.quoteDigest.toLowerCase() }
}

/** Validate Insight's Jupiter READY result without mistaking it for a signature. */
export function verifyInsightSolanaJupiterSwapGuardResult(value: unknown): InsightSolanaJupiterSwapGuardVerification {
  try {
    const decision = decisionShape(value)
    if (!decision) return { valid: false, reason: 'MALFORMED', quoteDigest: null, inputMint: null, outputMint: null, amountInRaw: null }
    const reference = decision.guard.risk_verdict_ref
    return { valid: true, reason: 'OK', quoteDigest: reference.quoteDigest, inputMint: decision.swap.direction.inputMint, outputMint: decision.swap.direction.outputMint, amountInRaw: decision.swap.quote!.amountInRaw }
  } catch {
    return { valid: false, reason: 'VERIFICATION_ERROR', quoteDigest: null, inputMint: null, outputMint: null, amountInRaw: null }
  }
}

/**
 * Build a PriorSeal intent from the exact compiled Solana message supplied by
 * the caller after Jupiter returned its base64 transaction. PriorSeal never
 * decodes or reconstructs a Jupiter route and never treats the unsigned READY
 * result as an independently signed Insight attestation.
 */
export function buildSolanaJupiterSwapBoundIntent(input: SolanaTransactionIntentInput, decisionValue: unknown): Intent {
  const decision = decisionShape(structuredClone(decisionValue))
  if (!decision) throw new TypeError('SOLANA_JUPITER_SWAP_GUARD_MALFORMED')
  const expectedAsset = `${SOLANA_MAINNET_CAIP2}/spl:${decision.swap.direction.inputMint}`
  if (input.asset !== expectedAsset || input.amount !== decision.swap.quote!.amountInRaw) throw new TypeError('SOLANA_JUPITER_SWAP_GUARD_INPUT_SCOPE_MISMATCH')
  if (input.contextCommitments?.some((entry) => entry.namespace.toLowerCase() === INSIGHT_SOLANA_JUPITER_SWAP_GUARD_NAMESPACE)) throw new TypeError('SOLANA_JUPITER_SWAP_GUARD_RESERVED_NAMESPACE')
  const intent = buildSolanaTransactionIntent({ ...input, validUntil: input.validUntil, contextCommitments: [...(input.contextCommitments ?? []), solanaJupiterSwapGuardCommitment(decision)] })
  if (intent.executionProfile !== SOLANA_TRANSACTION_PROFILE || intent.chainRef !== SOLANA_MAINNET_CAIP2 || intent.sender !== input.transaction.feePayer || intent.asset !== expectedAsset || intent.amount !== decision.swap.quote!.amountInRaw || !matchUniqueContextCommitment(intent, solanaJupiterSwapGuardCommitment(decision)).matched) throw new Error('SOLANA_JUPITER_SWAP_GUARD_INTENT_SCOPE_MISMATCH')
  return intent
}

/** Verify that an issued PriorSeal authorization still names the same Jupiter route context and exact message. */
export function verifySolanaJupiterSwapAuthorizationBinding(authorization: Authorization | unknown, decisionValue: unknown): { valid: boolean; reason: string } {
  const decision = decisionShape(decisionValue)
  if (!decision || !isRecord(authorization) || !isRecord(authorization.intent)) return { valid: false, reason: 'MALFORMED' }
  try {
    const intent = authorization.intent as Intent
    const expectedAsset = `${SOLANA_MAINNET_CAIP2}/spl:${decision.swap.direction.inputMint}`
    if (intent.executionProfile !== SOLANA_TRANSACTION_PROFILE || intent.chainRef !== SOLANA_MAINNET_CAIP2 || intent.asset !== expectedAsset || intent.amount !== decision.swap.quote!.amountInRaw || !intent.solanaTransaction || !matchUniqueContextCommitment(intent, solanaJupiterSwapGuardCommitment(decision)).matched) return { valid: false, reason: 'SOLANA_JUPITER_SWAP_GUARD_SCOPE_MISMATCH' }
    return { valid: true, reason: 'OK' }
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : 'BINDING_MISMATCH' }
  }
}

