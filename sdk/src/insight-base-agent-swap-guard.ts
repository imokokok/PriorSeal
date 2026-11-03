/**
 * Bind Insight's narrow Base DEX guard to two ordered PriorSeal exact-call
 * intents. An ERC-20 approval is intentionally not batched with the swap:
 * each call gets its own authorization and evidence, with adjacent nonces.
 */

import { hashTypedData, keccak256, toBytes, verifyTypedData } from 'viem'
import type { KeyRegistry } from 'verify-insight-receipt'

import { matchUniqueContextCommitment } from './context-commitment.js'
import { buildExactCallIntent } from './exact-call.js'
import type { Authorization, ContextCommitment, ExactCallIntentInput, Intent, Receipt } from './types.js'
import { verifyReceiptLocally, type LocalVerifierOptions } from './verifier.js'

export const INSIGHT_BASE_AGENT_SWAP_GUARD_NAMESPACE = 'insight.base-agent-swap-guard.v1' as const
export const INSIGHT_BASE_AGENT_SWAP_GUARD_SCHEMA = 'insight.base-agent-swap-guard-decision.v1' as const
export const BASE_AGENT_SWAP_GUARD_INTENT_ASSET_PREFIX = 'eip155:8453/erc20:' as const

const DOMAIN = { name: 'Insight Base Agent Swap Guard', version: '1', chainId: 1 } as const
const TYPES = {
  BaseAgentSwapGuardDecision: [
    { name: 'decisionHash', type: 'bytes32' },
    { name: 'approvalCalldataHash', type: 'bytes32' },
    { name: 'swapCalldataHash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verdict', type: 'uint8' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'schemaVersion', type: 'uint256' },
  ],
} as const
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/
const UINT = /^(?:0|[1-9][0-9]*)$/
const MAX_VALID_FOR_SECONDS = 120
const LABEL = 'Insight Base Agent Swap Guard attester'
const SUPPORTED_PROFILE_IDS = new Set([
  'base-aerodrome-slipstream-weth-usdc-cl100',
  'base-pancakeswap-v3-usdc-usdt-100',
])

export type InsightBaseAgentSwapGuardDecision = {
  schema: typeof INSIGHT_BASE_AGENT_SWAP_GUARD_SCHEMA
  guard: {
    schema: 'insight.base-agent-swap-guard.v1'
    verdict: 'ALLOW' | 'CAUTION' | 'BLOCK'
    validUntil: number | null
    scope: { chainId: 8453; [key: string]: unknown }
    market: { exactInput: { amountInRaw: string; [key: string]: unknown }; [key: string]: unknown } | null
    binding: {
      chainId: 8453
      recipient: string
      approval: { token: string; spender: string; amountRaw: string; calldataHash: `0x${string}` }
      swap: { to: string; value: '0x0'; calldataHash: `0x${string}` }
    } | null
    transactionsToSign: {
      approval: { to: string; value: '0x0'; data: `0x${string}` }
      swap: { to: string; value: '0x0'; data: `0x${string}` }
    } | null
    decisionHash: `0x${string}`
    [key: string]: unknown
  }
  decisionHash: `0x${string}`
  attestation: {
    type: 'BaseAgentSwapGuardDecision'
    schemaVersion: 1
    uid: `0x${string}`
    attester: string
    attesterLabel: typeof LABEL
    signedAt: string
    validForSeconds: number
    signature: `0x${string}`
    verifyUrl: string
    data: {
      decisionHash: `0x${string}`
      approvalCalldataHash: `0x${string}`
      swapCalldataHash: `0x${string}`
      recipient: string
      chainId: 8453
      verdict: 0
      issuedAt: number
      validUntil: number
      schemaVersion: 1
    }
    eip712: Record<string, unknown>
  } | null
}

export type InsightBaseAgentSwapGuardVerification = {
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

export type BaseAgentSwapGuardBoundIntents = { approval: Intent; swap: Intent }
export type BaseAgentSwapGuardVerificationOptions = {
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
  if (depth > 64) throw new TypeError('Base agent swap decision exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new TypeError('Base agent swap decision is too large')
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    if (keys.length > 20_000 || keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key)))
      throw new TypeError('Unsafe Base agent swap decision JSON')
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
  }
  throw new TypeError('Base agent swap decision is not canonical JSON')
}

function uint(value: unknown): string | null {
  try {
    if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))) return null
    const result = String(value)
    return UINT.test(result) ? result : null
  } catch { return null }
}

function sameAddress(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && ADDRESS.test(left) && ADDRESS.test(right) && left.toLowerCase() === right.toLowerCase()
}

function sameHash(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && HEX32.test(left) && HEX32.test(right) && left.toLowerCase() === right.toLowerCase()
}

/** Shared Insight published-key trust check: one matching, non-revoked,
 *  role-carrying attester key valid at the signing instant. Reused by the
 *  settlement and perp-guard consumers of the same oracle-keys registry. */
export function insightKeyRegistryTrust(registry: KeyRegistry | undefined, address: string, issuedAt: number): boolean {
  if (!registry || !isRecord(registry) || (registry.public_keys && registry.keys) || (registry.revoked_keys && registry.revoked)) return false
  const rawKeys = registry.public_keys ?? registry.keys
  if (!Array.isArray(rawKeys) || rawKeys.length < 1 || rawKeys.length > 100) return false
  const matches = rawKeys.filter((key) => isRecord(key) && typeof key.public_key === 'string' && key.public_key.toLowerCase() === address.toLowerCase())
  if (matches.length !== 1) return false
  const key = matches[0]
  if (key.revoked !== false || (key.role !== undefined && key.role !== 'attester') || typeof key.key_id !== 'string' || typeof key.validFrom !== 'string' || !Number.isFinite(Date.parse(key.validFrom)) || (key.validUntil !== null && (typeof key.validUntil !== 'string' || !Number.isFinite(Date.parse(key.validUntil))))) return false
  const validFrom = Date.parse(key.validFrom) / 1000
  const validUntil = key.validUntil === null ? null : Date.parse(key.validUntil) / 1000
  if (issuedAt < validFrom || (validUntil !== null && issuedAt >= validUntil)) return false
  const revoked = registry.revoked_keys ?? registry.revoked ?? []
  return Array.isArray(revoked) && !revoked.some((item) => isRecord(item) && item.key_id === key.key_id)
}

function asDecision(value: unknown): InsightBaseAgentSwapGuardDecision | null {
  if (!isRecord(value) || value.schema !== INSIGHT_BASE_AGENT_SWAP_GUARD_SCHEMA || !isRecord(value.guard) || !isRecord(value.attestation)) return null
  return value as unknown as InsightBaseAgentSwapGuardDecision
}

function guardDecisionHash(guard: InsightBaseAgentSwapGuardDecision['guard']): `0x${string}` | null {
  try {
    const { decisionHash: _ignored, ...unsigned } = guard
    return keccak256(toBytes(canonicalJson(unsigned)))
  } catch { return null }
}

function typedData(data: NonNullable<InsightBaseAgentSwapGuardDecision['attestation']>['data']) {
  return {
    domain: DOMAIN,
    types: TYPES,
    primaryType: 'BaseAgentSwapGuardDecision' as const,
    message: {
      decisionHash: data.decisionHash,
      approvalCalldataHash: data.approvalCalldataHash,
      swapCalldataHash: data.swapCalldataHash,
      recipient: data.recipient as `0x${string}`,
      chainId: 8453n,
      verdict: 0,
      issuedAt: BigInt(data.issuedAt),
      validUntil: BigInt(data.validUntil),
      schemaVersion: 1n,
    },
  } as const
}

function callsAreBound(decision: InsightBaseAgentSwapGuardDecision): boolean {
  const { guard } = decision
  const binding = guard.binding
  const calls = guard.transactionsToSign
  return Boolean(
    guard.schema === 'insight.base-agent-swap-guard.v1' && guard.verdict === 'ALLOW' && guard.scope?.chainId === 8453 && SUPPORTED_PROFILE_IDS.has(guard.scope?.profileId as string) &&
    Number.isSafeInteger(guard.validUntil) && guard.validUntil !== null && guard.market && binding && calls &&
    binding.chainId === 8453 && sameAddress(calls.approval.to, binding.approval.token) && calls.approval.value === '0x0' &&
    sameHash(keccak256(calls.approval.data), binding.approval.calldataHash) &&
    sameAddress(calls.swap.to, binding.swap.to) && sameAddress(binding.approval.spender, calls.swap.to) && calls.swap.value === '0x0' &&
    sameHash(keccak256(calls.swap.data), binding.swap.calldataHash) &&
    binding.approval.amountRaw === guard.market.exactInput.amountInRaw
  )
}

/** Opaque commitment added to both ordered exact-call intents. */
export function baseAgentSwapGuardCommitment(decision: Pick<InsightBaseAgentSwapGuardDecision, 'decisionHash'>): ContextCommitment {
  if (!HEX32.test(decision.decisionHash)) throw new TypeError('Base agent swap decision hash must be 32-byte hex')
  return { namespace: INSIGHT_BASE_AGENT_SWAP_GUARD_NAMESPACE, algorithm: 'keccak256', digest: decision.decisionHash.toLowerCase() }
}

/** CAIP-19-style source-token asset label used for approval and exact-input swap. */
export function baseAgentSwapGuardIntentAsset(token: string): string {
  if (!ADDRESS.test(token)) throw new TypeError('Base agent swap token must be a 20-byte EVM address')
  return `${BASE_AGENT_SWAP_GUARD_INTENT_ASSET_PREFIX}${token.toLowerCase()}`
}

/** Independently verify Insight's signed ALLOW plus its two exact calldata bindings. */
export async function verifyInsightBaseAgentSwapGuardDecision(value: unknown, options: BaseAgentSwapGuardVerificationOptions = {}): Promise<InsightBaseAgentSwapGuardVerification> {
  const empty = { valid: false, signatureValid: false, trusted: false, expired: false, reason: 'MALFORMED', decisionHash: null, attester: null, issuedAt: null, validUntil: null } as const
  try {
    const decision = asDecision(value)
    if (!decision || !decision.attestation) return { ...empty, reason: 'MISSING_OR_MALFORMED_ATTESTATION' }
    const { guard, attestation } = decision
    const data = attestation.data
    const expectedHash = guardDecisionHash(guard)
    if (!expectedHash || !callsAreBound(decision) || !sameHash(expectedHash, guard.decisionHash) || !sameHash(expectedHash, decision.decisionHash) || !sameHash(expectedHash, data.decisionHash) || !sameHash(data.approvalCalldataHash, guard.binding!.approval.calldataHash) || !sameHash(data.swapCalldataHash, guard.binding!.swap.calldataHash) || !sameAddress(data.recipient, guard.binding!.recipient)) return { ...empty, reason: 'CALL_BINDING_MISMATCH', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data?.issuedAt ?? null, validUntil: data?.validUntil ?? null }
    if (!HEX32.test(attestation.uid) || !ADDRESS.test(attestation.attester) || attestation.type !== 'BaseAgentSwapGuardDecision' || attestation.schemaVersion !== 1 || attestation.attesterLabel !== LABEL || !SIGNATURE.test(attestation.signature) || !HEX32.test(data.decisionHash) || !HEX32.test(data.approvalCalldataHash) || !HEX32.test(data.swapCalldataHash) || !ADDRESS.test(data.recipient) || data.chainId !== 8453 || data.verdict !== 0 || data.schemaVersion !== 1 || !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.validUntil) || data.issuedAt < 0 || data.validUntil <= data.issuedAt || data.validUntil !== guard.validUntil || attestation.validForSeconds !== data.validUntil - data.issuedAt || attestation.validForSeconds < 1 || attestation.validForSeconds > MAX_VALID_FOR_SECONDS || attestation.signedAt !== new Date(data.issuedAt * 1000).toISOString() || canonicalJson(attestation.eip712) !== canonicalJson({ domain: DOMAIN, types: TYPES, primaryType: 'BaseAgentSwapGuardDecision' })) return { ...empty, reason: 'MALFORMED', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const args = typedData(data)
    if (!sameHash(hashTypedData(args), attestation.uid)) return { ...empty, reason: 'UID_MISMATCH', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const signatureValid = await verifyTypedData({ ...args, address: attestation.attester as `0x${string}`, signature: attestation.signature })
    if (!signatureValid) return { ...empty, reason: 'SIGNATURE_INVALID', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const trusted = insightKeyRegistryTrust(options.keyRegistry, attestation.attester, data.issuedAt)
    if (!trusted) return { ...empty, signatureValid: true, reason: 'SIGNER_UNTRUSTED', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const expired = data.validUntil <= (options.now ?? Math.floor(Date.now() / 1000))
    const valid = options.allowHistorical ? data.validUntil > data.issuedAt : !expired
    return { valid, signatureValid: true, trusted: true, expired, reason: valid ? 'OK' : 'EXPIRED', decisionHash: expectedHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
  } catch { return { ...empty, reason: 'VERIFICATION_ERROR' } }
}

function isExactTransaction(value: ExactCallIntentInput['transaction'], expected: { to: string; data: string }, sender: string): boolean {
  return value.chainId === 8453 && sameAddress(value.from, sender) && sameAddress(value.to, expected.to) &&
    typeof value.data === 'string' && value.data.toLowerCase() === expected.data.toLowerCase() && uint(value.value ?? 0) === '0'
}

function scopeIntent(intent: Intent, decision: InsightBaseAgentSwapGuardDecision, stage: 'approval' | 'swap', now: number): void {
  const guard = decision.guard
  const attestation = decision.attestation!
  const binding = guard.binding!
  const calls = guard.transactionsToSign!
  const expected = stage === 'approval' ? calls.approval : calls.swap
  if (intent.schema !== 'priorseal.intent.v2' || intent.executionProfile !== 'priorseal.execution-profile.exact-call.v1' || intent.action !== 'CONTRACT_CALL' || intent.asset !== baseAgentSwapGuardIntentAsset(binding.approval.token) || intent.amount !== binding.approval.amountRaw || Number(intent.chainId) !== 8453 || !sameAddress(intent.sender, binding.recipient) || !sameAddress(intent.callTarget, expected.to) || !sameAddress(intent.recipient, expected.to) || !sameHash(intent.calldataHash, stage === 'approval' ? binding.approval.calldataHash : binding.swap.calldataHash) || intent.transactionValue !== '0' || !Number.isSafeInteger(intent.validUntil) || intent.validUntil > attestation.data.validUntil || now >= intent.validUntil || !matchUniqueContextCommitment(intent, baseAgentSwapGuardCommitment(decision)).matched) throw new Error(`BASE_AGENT_SWAP_GUARD_${stage.toUpperCase()}_SCOPE_MISMATCH`)
}

/**
 * Create the only supported Base swap closure: exact token approval followed
 * by exact swap. The calls must come from the recipient wallet at consecutive
 * nonces and share the same authorization deadline.
 */
export async function buildBaseAgentSwapGuardBoundIntents(input: { approval: ExactCallIntentInput; swap: ExactCallIntentInput }, decisionValue: unknown, options: BaseAgentSwapGuardVerificationOptions = {}): Promise<BaseAgentSwapGuardBoundIntents> {
  const decision = asDecision(structuredClone(decisionValue))
  if (!decision) throw new TypeError('BASE_AGENT_SWAP_GUARD_MALFORMED')
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const verification = await verifyInsightBaseAgentSwapGuardDecision(decision, { ...options, now })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') throw new TypeError(`BASE_AGENT_SWAP_GUARD_BLOCKED:${verification.reason}`)
  if (input.approval.intentId === input.swap.intentId) throw new TypeError('BASE_AGENT_SWAP_GUARD_INTENT_IDS_MUST_DIFFER')
  if (input.approval.validUntil !== input.swap.validUntil) throw new TypeError('BASE_AGENT_SWAP_GUARD_CALLS_MUST_SHARE_EXPIRY')
  if (input.approval.contextCommitments?.some((entry) => entry.namespace.toLowerCase() === INSIGHT_BASE_AGENT_SWAP_GUARD_NAMESPACE) || input.swap.contextCommitments?.some((entry) => entry.namespace.toLowerCase() === INSIGHT_BASE_AGENT_SWAP_GUARD_NAMESPACE)) throw new TypeError('BASE_AGENT_SWAP_GUARD_RESERVED_NAMESPACE')
  const binding = decision.guard.binding!
  const calls = decision.guard.transactionsToSign!
  if (!isExactTransaction(input.approval.transaction, calls.approval, binding.recipient) || !isExactTransaction(input.swap.transaction, calls.swap, binding.recipient) || input.approval.asset !== baseAgentSwapGuardIntentAsset(binding.approval.token) || input.swap.asset !== baseAgentSwapGuardIntentAsset(binding.approval.token) || String(input.approval.amount) !== binding.approval.amountRaw || String(input.swap.amount) !== binding.approval.amountRaw) throw new TypeError('BASE_AGENT_SWAP_GUARD_INPUT_SCOPE_MISMATCH')
  const approvalNonce = uint(input.approval.transaction.nonce)
  const swapNonce = uint(input.swap.transaction.nonce)
  if (approvalNonce === null || swapNonce === null || BigInt(swapNonce) !== BigInt(approvalNonce) + 1n) throw new TypeError('BASE_AGENT_SWAP_GUARD_NONCES_NOT_CONSECUTIVE')
  const validUntil = Math.min(input.approval.validUntil, decision.attestation.data.validUntil)
  const commitment = baseAgentSwapGuardCommitment(decision)
  const approval = buildExactCallIntent({ ...structuredClone(input.approval), validUntil, contextCommitments: [...(input.approval.contextCommitments ?? []), commitment] })
  const swap = buildExactCallIntent({ ...structuredClone(input.swap), validUntil, contextCommitments: [...(input.swap.contextCommitments ?? []), commitment] })
  scopeIntent(approval, decision, 'approval', now)
  scopeIntent(swap, decision, 'swap', now)
  return { approval, swap }
}

/** Verify two issued authorizations retain the ordered, bounded Insight decision binding. */
export async function verifyBaseAgentSwapGuardAuthorizationBundle(input: { approval: Authorization | unknown; swap: Authorization | unknown; decision: unknown }, options: BaseAgentSwapGuardVerificationOptions = {}): Promise<{ valid: boolean; reason: string }> {
  const decision = asDecision(input.decision)
  if (!decision || !isRecord(input.approval) || !isRecord(input.swap) || !isRecord(input.approval.intent) || !isRecord(input.swap.intent) || !Number.isSafeInteger(input.approval.issuedAt) || !Number.isSafeInteger(input.swap.issuedAt) || !Number.isSafeInteger(input.approval.expiresAt) || !Number.isSafeInteger(input.swap.expiresAt)) return { valid: false, reason: 'MALFORMED' }
  const issuedAt = Math.max(Number(input.approval.issuedAt), Number(input.swap.issuedAt))
  const verification = await verifyInsightBaseAgentSwapGuardDecision(decision, { ...options, now: issuedAt, allowHistorical: true })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') return { valid: false, reason: `INSIGHT_${verification.reason}` }
  try {
    scopeIntent(input.approval.intent as Intent, decision, 'approval', issuedAt)
    scopeIntent(input.swap.intent as Intent, decision, 'swap', issuedAt)
    const approvalNonce = uint((input.approval.intent as Intent).nonce)
    const swapNonce = uint((input.swap.intent as Intent).nonce)
    if (approvalNonce === null || swapNonce === null || BigInt(swapNonce) !== BigInt(approvalNonce) + 1n) return { valid: false, reason: 'NONCES_NOT_CONSECUTIVE' }
    if ((input.approval.intent as Intent).validUntil !== (input.swap.intent as Intent).validUntil) return { valid: false, reason: 'INTENT_EXPIRY_MISMATCH' }
    if (Number(input.approval.expiresAt) > decision.attestation.data.validUntil || Number(input.swap.expiresAt) > decision.attestation.data.validUntil) return { valid: false, reason: 'AUTHORIZATION_OUTLIVES_INSIGHT_DECISION' }
    return { valid: true, reason: 'OK' }
  } catch (error) { return { valid: false, reason: error instanceof Error ? error.message : 'BINDING_MISMATCH' } }
}

/** Verify two PriorSeal receipts and their complete ordered Insight decision binding. */
export async function verifyBaseAgentSwapGuardReceiptBundle(input: { approvalReceipt: Receipt | unknown; swapReceipt: Receipt | unknown; decision: unknown; priorSealTrust: LocalVerifierOptions; insightTrust: BaseAgentSwapGuardVerificationOptions }): Promise<{ valid: boolean; reason: string }> {
  const [approvalResult, swapResult] = await Promise.all([verifyReceiptLocally(input.approvalReceipt, input.priorSealTrust), verifyReceiptLocally(input.swapReceipt, input.priorSealTrust)])
  if (!approvalResult.valid || !swapResult.valid || !isRecord(input.approvalReceipt) || !isRecord(input.swapReceipt) || !isRecord(input.approvalReceipt.authorizationEvidence) || !isRecord(input.swapReceipt.authorizationEvidence)) return { valid: false, reason: `PRIORSEAL_${!approvalResult.valid ? approvalResult.code : swapResult.code}` }
  return verifyBaseAgentSwapGuardAuthorizationBundle({ approval: input.approvalReceipt.authorizationEvidence.authorization, swap: input.swapReceipt.authorizationEvidence.authorization, decision: input.decision }, input.insightTrust)
}
