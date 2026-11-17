import { decodeFunctionData, encodeFunctionData, hashTypedData, keccak256, toBytes, verifyTypedData } from 'viem'
import type { KeyRegistry } from 'verify-insight-receipt'

import { matchUniqueContextCommitment } from './context-commitment.js'
import { buildExactCallIntent } from './exact-call.js'
import type { Authorization, ContextCommitment, ExactCallIntentInput, Intent, Receipt } from './types.js'
import { verifyReceiptLocally, type LocalVerifierOptions } from './verifier.js'
import { insightKeyRegistryTrust } from './insight-base-agent-swap-guard.js'

export const HYPEREVM_CHAIN_ID = 999 as const
export const HYPERLEND_CORE_POOL = '0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b' as const
export const INSIGHT_HYPEREVM_LENDING_GUARD_NAMESPACE = 'insight.hyperevm-lending-guard.v1' as const
export const INSIGHT_HYPEREVM_LENDING_GUARD_SCHEMA = 'insight.hyperevm-lending-guard-decision.v1' as const
export const HYPEREVM_LENDING_GUARD_INTENT_ASSET_PREFIX = 'eip155:999/lending:' as const

const DOMAIN = { name: 'Insight HyperEVM Lending Guard', version: '1', chainId: HYPEREVM_CHAIN_ID } as const
const TYPES = { HyperEvmLendingGuardDecision: [
  { name: 'decisionHash', type: 'bytes32' }, { name: 'calldataHash', type: 'bytes32' },
  { name: 'account', type: 'address' }, { name: 'chainId', type: 'uint256' },
  { name: 'verdict', type: 'uint8' }, { name: 'issuedAt', type: 'uint256' },
  { name: 'validUntil', type: 'uint256' }, { name: 'schemaVersion', type: 'uint256' },
] } as const
const HYPERLEND_POOL_ABI = [
  { type: 'function', name: 'supply', stateMutability: 'nonpayable', inputs: [
    { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
    { name: 'onBehalfOf', type: 'address' }, { name: 'referralCode', type: 'uint16' },
  ], outputs: [] },
  { type: 'function', name: 'borrow', stateMutability: 'nonpayable', inputs: [
    { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
    { name: 'interestRateMode', type: 'uint256' }, { name: 'referralCode', type: 'uint16' },
    { name: 'onBehalfOf', type: 'address' },
  ], outputs: [] },
] as const
const HYPERLEND_CORE_ASSETS = {
  WHYPE: '0x5555555555555555555555555555555555555555',
  WSTHYPE: '0x94e8396e0869c9F2200760aF0621aFd240E1CF38',
  UBTC: '0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463',
  UETH: '0xBe6727B535545C67d5cAa73dEa54865B92CF7907',
  USDE: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
  SUSDE: '0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2',
  USDT0: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
  KHYPE: '0xfD739d4e423301CE9385c1fb8850539D657C296D',
  USDC: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
} as const
const SYMBOL_ALIASES: Record<string, keyof typeof HYPERLEND_CORE_ASSETS> = {
  HYPE: 'WHYPE', WHYPE: 'WHYPE', WSTHYPE: 'WSTHYPE', BTC: 'UBTC', UBTC: 'UBTC',
  ETH: 'UETH', UETH: 'UETH', USDE: 'USDE', SUSDE: 'SUSDE', USDT: 'USDT0',
  USDT0: 'USDT0', KHYPE: 'KHYPE', USDC: 'USDC',
}
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/
const UINT = /^(?:0|[1-9][0-9]*)$/
const VALID_FOR_SECONDS = 300
const LABEL = 'Insight HyperEVM Lending Guard attester'
const PROTOCOL_ID = 'hyperlend-core-hyperevm' as const

export type InsightHyperEvmLendingGuardDecision = {
  schema: typeof INSIGHT_HYPEREVM_LENDING_GUARD_SCHEMA
  guard: {
    schema: typeof INSIGHT_HYPEREVM_LENDING_GUARD_NAMESPACE; verdict: 'ALLOW' | 'CAUTION' | 'BLOCK'
    protocolId: typeof PROTOCOL_ID; action: 'supply' | 'borrow'; scope: { chainId: typeof HYPEREVM_CHAIN_ID; [key: string]: unknown }
    market: { collateralSymbol: string; loanSymbol: string; [key: string]: unknown }; [key: string]: unknown
  }
  transaction: { chainId: typeof HYPEREVM_CHAIN_ID; from: string; to: string; data: `0x${string}`; nonce: string | number; value: string | number }
  action: { protocolId: typeof PROTOCOL_ID; action: 'supply' | 'borrow'; target: string; calldataHash: `0x${string}`; amount: string; account: string; receiver: string | null; asset: string | null }
  decisionHash: `0x${string}`
  attestation: {
    type: 'HyperEvmLendingGuardDecision'; schemaVersion: 1; uid: `0x${string}`; attester: string
    attesterLabel: typeof LABEL; signedAt: string; validForSeconds: 300; signature: `0x${string}`; verifyUrl: string
    data: { decisionHash: `0x${string}`; calldataHash: `0x${string}`; account: string; chainId: typeof HYPEREVM_CHAIN_ID; verdict: 0 | 1 | 2; issuedAt: number; validUntil: number; schemaVersion: 1 }
    eip712: Record<string, unknown>
  } | null
}
export type InsightHyperEvmLendingGuardVerification = {
  valid: boolean; signatureValid: boolean; trusted: boolean; expired: boolean; reason: string
  decisionHash: string | null; attester: string | null; issuedAt: number | null; validUntil: number | null
}
export type HyperEvmLendingGuardVerificationOptions = { keyRegistry?: KeyRegistry; now?: number; allowHistorical?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('HyperEVM lending decision exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new TypeError('HyperEVM lending decision is too large')
    return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(',')}]`
  }
  if (!isRecord(value)) throw new TypeError('HyperEVM lending decision is not canonical JSON')
  const keys = Object.keys(value).sort()
  if (keys.length > 20_000 || keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new TypeError('Unsafe HyperEVM lending decision JSON')
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
}
function uint(value: unknown): string | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))) return null
  const result = String(value)
  return UINT.test(result) ? result : null
}
function verdictCode(value: string): 0 | 1 | 2 | null { return value === 'ALLOW' ? 0 : value === 'CAUTION' ? 1 : value === 'BLOCK' ? 2 : null }
function sameAddress(left: unknown, right: unknown): boolean { return typeof left === 'string' && typeof right === 'string' && ADDRESS.test(left) && ADDRESS.test(right) && left.toLowerCase() === right.toLowerCase() }
function symbolAsset(symbol: string): string | null {
  const key = SYMBOL_ALIASES[symbol.trim().toUpperCase()]
  return key ? HYPERLEND_CORE_ASSETS[key].toLowerCase() : null
}
function validVerificationUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value))
    return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) && !url.username && !url.password && !url.hash && url.pathname === '/api/v1/safety/hyperevm-lending-guard/verify'
  } catch { return false }
}
function asDecision(value: unknown): InsightHyperEvmLendingGuardDecision | null {
  if (!isRecord(value) || value.schema !== INSIGHT_HYPEREVM_LENDING_GUARD_SCHEMA || !isRecord(value.guard) || !isRecord(value.transaction) || !isRecord(value.action) || !isRecord(value.attestation)) return null
  return value as unknown as InsightHyperEvmLendingGuardDecision
}
function unsignedDecision(decision: InsightHyperEvmLendingGuardDecision) { return { schema: decision.schema, guard: decision.guard, transaction: decision.transaction, action: decision.action } }
function typedData(data: NonNullable<InsightHyperEvmLendingGuardDecision['attestation']>['data']) {
  return { domain: DOMAIN, types: TYPES, primaryType: 'HyperEvmLendingGuardDecision' as const, message: {
    decisionHash: data.decisionHash, calldataHash: data.calldataHash, account: data.account as `0x${string}`, chainId: BigInt(data.chainId), verdict: data.verdict, issuedAt: BigInt(data.issuedAt), validUntil: BigInt(data.validUntil), schemaVersion: 1n,
  } }
}
function exactCallMatches(decision: InsightHyperEvmLendingGuardDecision): boolean {
  const { guard, transaction, action } = decision
  if (transaction.value !== 0 && transaction.value !== '0') return false
  if (transaction.to.toLowerCase() !== HYPERLEND_CORE_POOL.toLowerCase()) return false
  const data = transaction.data as `0x${string}`
  try {
    const decoded = decodeFunctionData({ abi: HYPERLEND_POOL_ABI, data })
    const canonical = encodeFunctionData({ abi: HYPERLEND_POOL_ABI, functionName: decoded.functionName, args: decoded.args })
    if (canonical.toLowerCase() !== data.toLowerCase()) return false
    if (decoded.functionName !== guard.action || action.action !== decoded.functionName) return false
    if (decoded.functionName === 'supply') {
      const [asset, amount, onBehalfOf] = decoded.args
      const expectedAsset = symbolAsset(guard.market.collateralSymbol)
      return amount > 0n && sameAddress(onBehalfOf, transaction.from) && expectedAsset !== null && sameAddress(asset, expectedAsset) && action.amount === amount.toString() && action.receiver === null && action.asset !== null && sameAddress(action.asset, expectedAsset)
    }
    const [asset, amount, interestRateMode, _referralCode, onBehalfOf] = decoded.args
    const expectedAsset = symbolAsset(guard.market.loanSymbol)
    return amount > 0n && interestRateMode === 2n && sameAddress(onBehalfOf, transaction.from) && expectedAsset !== null && sameAddress(asset, expectedAsset) && action.amount === amount.toString() && action.receiver !== null && sameAddress(action.receiver, transaction.from) && action.asset !== null && sameAddress(action.asset, expectedAsset)
  } catch { return false }
}

export function hyperEvmLendingGuardCommitment(decision: Pick<InsightHyperEvmLendingGuardDecision, 'decisionHash'>): ContextCommitment {
  if (!HEX32.test(decision.decisionHash)) throw new TypeError('HyperEVM lending decision hash must be 32-byte hex')
  return { namespace: INSIGHT_HYPEREVM_LENDING_GUARD_NAMESPACE, algorithm: 'keccak256', digest: decision.decisionHash.toLowerCase() as `0x${string}` }
}
export function hyperEvmLendingGuardIntentAsset(protocolId: typeof PROTOCOL_ID = PROTOCOL_ID): string { return `${HYPEREVM_LENDING_GUARD_INTENT_ASSET_PREFIX}${protocolId}` }

export async function verifyInsightHyperEvmLendingGuardDecision(value: unknown, options: HyperEvmLendingGuardVerificationOptions = {}): Promise<InsightHyperEvmLendingGuardVerification> {
  const empty = { valid: false, signatureValid: false, trusted: false, expired: false, reason: 'MALFORMED', decisionHash: null, attester: null, issuedAt: null, validUntil: null } as const
  try {
    const decision = asDecision(value)
    if (!decision || !decision.attestation) return { ...empty, reason: 'MISSING_OR_MALFORMED_ATTESTATION' }
    const { guard, transaction, action, attestation } = decision
    const data = attestation.data
    const nonce = uint(transaction.nonce), valueString = uint(transaction.value), expectedVerdict = verdictCode(guard.verdict)
    if (guard.schema !== INSIGHT_HYPEREVM_LENDING_GUARD_NAMESPACE || guard.verdict !== 'ALLOW' || guard.protocolId !== PROTOCOL_ID || !['supply', 'borrow'].includes(guard.action) || guard.action !== action.action || !isRecord(guard.scope) || guard.scope.chainId !== HYPEREVM_CHAIN_ID || !isRecord(guard.market) || transaction.chainId !== HYPEREVM_CHAIN_ID || !ADDRESS.test(transaction.from) || !ADDRESS.test(transaction.to) || !/^0x(?:[0-9a-fA-F]{2})+$/.test(transaction.data) || nonce === null || valueString !== '0' || action.protocolId !== PROTOCOL_ID || !['supply', 'borrow'].includes(action.action) || !ADDRESS.test(action.target) || !sameAddress(action.target, transaction.to) || !HEX32.test(action.calldataHash) || action.calldataHash.toLowerCase() !== keccak256(transaction.data).toLowerCase() || !UINT.test(action.amount) || !ADDRESS.test(action.account) || !sameAddress(action.account, transaction.from) || (action.receiver !== null && !ADDRESS.test(action.receiver)) || (action.asset !== null && !ADDRESS.test(action.asset)) || !exactCallMatches(decision) || !HEX32.test(decision.decisionHash) || !HEX32.test(data.decisionHash) || !HEX32.test(data.calldataHash) || !ADDRESS.test(data.account) || data.chainId !== HYPEREVM_CHAIN_ID || data.verdict !== expectedVerdict || !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.validUntil) || data.schemaVersion !== 1 || attestation.type !== 'HyperEvmLendingGuardDecision' || attestation.schemaVersion !== 1 || attestation.attesterLabel !== LABEL || !HEX32.test(attestation.uid) || !ADDRESS.test(attestation.attester) || !SIGNATURE.test(attestation.signature) || !validVerificationUrl(attestation.verifyUrl) || attestation.validForSeconds !== VALID_FOR_SECONDS || attestation.signedAt !== new Date(data.issuedAt * 1000).toISOString() || data.validUntil - data.issuedAt !== VALID_FOR_SECONDS || canonicalJson(attestation.eip712) !== canonicalJson({ domain: DOMAIN, types: TYPES, primaryType: 'HyperEvmLendingGuardDecision' })) return { ...empty, reason: 'MALFORMED' }
    const decisionHash = keccak256(toBytes(canonicalJson(unsignedDecision(decision))))
    if (decisionHash.toLowerCase() !== decision.decisionHash.toLowerCase() || decisionHash.toLowerCase() !== data.decisionHash.toLowerCase() || data.calldataHash.toLowerCase() !== action.calldataHash.toLowerCase() || data.account.toLowerCase() !== action.account.toLowerCase()) return { ...empty, reason: 'DECISION_HASH_OR_CALL_BINDING_MISMATCH', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const signed = typedData(data)
    if (hashTypedData(signed).toLowerCase() !== attestation.uid.toLowerCase()) return { ...empty, reason: 'UID_MISMATCH', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const signatureValid = await verifyTypedData({ ...signed, address: attestation.attester as `0x${string}`, signature: attestation.signature })
    if (!signatureValid) return { ...empty, reason: 'SIGNATURE_INVALID', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const trusted = insightKeyRegistryTrust(options.keyRegistry, attestation.attester, data.issuedAt)
    if (!trusted) return { ...empty, signatureValid: true, reason: 'SIGNER_UNTRUSTED', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const expired = data.validUntil <= (options.now ?? Math.floor(Date.now() / 1000))
    const valid = options.allowHistorical ? data.validUntil > data.issuedAt : !expired
    return { valid, signatureValid: true, trusted: true, expired, reason: valid ? 'OK' : 'EXPIRED', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
  } catch { return { ...empty, reason: 'VERIFICATION_ERROR' } }
}

function guardScope(intent: Intent, decision: InsightHyperEvmLendingGuardDecision, now: number): void {
  const attestation = decision.attestation
  if (!attestation || intent.schema !== 'priorseal.intent.v2' || intent.executionProfile !== 'priorseal.execution-profile.exact-call.v1' || intent.action !== 'CONTRACT_CALL' || intent.asset !== hyperEvmLendingGuardIntentAsset() || intent.amount !== decision.action.amount || Number(intent.chainId) !== HYPEREVM_CHAIN_ID || intent.sender.toLowerCase() !== decision.transaction.from.toLowerCase() || intent.callTarget?.toLowerCase() !== decision.transaction.to.toLowerCase() || intent.recipient.toLowerCase() !== decision.transaction.to.toLowerCase() || intent.calldataHash?.toLowerCase() !== decision.action.calldataHash.toLowerCase() || intent.transactionValue !== '0' || intent.nonce !== String(decision.transaction.nonce) || !Number.isSafeInteger(intent.validUntil) || intent.validUntil > attestation.data.validUntil || now >= intent.validUntil) throw new Error('HYPEREVM_LENDING_GUARD_CALL_SCOPE_MISMATCH')
  if (!matchUniqueContextCommitment(intent, hyperEvmLendingGuardCommitment(decision)).matched) throw new Error('HYPEREVM_LENDING_GUARD_CONTEXT_COMMITMENT_MISMATCH')
}

export async function buildHyperEvmLendingGuardBoundIntent(input: ExactCallIntentInput, decisionValue: unknown, options: HyperEvmLendingGuardVerificationOptions = {}): Promise<Intent> {
  input = structuredClone(input)
  const decision = asDecision(structuredClone(decisionValue))
  if (!decision) throw new TypeError('HYPEREVM_LENDING_GUARD_MALFORMED')
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const verification = await verifyInsightHyperEvmLendingGuardDecision(decision, { ...options, now })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') throw new TypeError(`HYPEREVM_LENDING_GUARD_BLOCKED:${verification.reason}`)
  if (input.contextCommitments?.some((entry) => entry.namespace.toLowerCase() === INSIGHT_HYPEREVM_LENDING_GUARD_NAMESPACE)) throw new TypeError('HYPEREVM_LENDING_GUARD_RESERVED_NAMESPACE')
  if (input.asset !== hyperEvmLendingGuardIntentAsset() || String(input.amount) !== decision.action.amount || canonicalJson(input.transaction) !== canonicalJson(decision.transaction)) throw new TypeError('HYPEREVM_LENDING_GUARD_INPUT_SCOPE_MISMATCH')
  const intent = buildExactCallIntent({ ...input, validUntil: Math.min(input.validUntil, decision.attestation.data.validUntil), contextCommitments: [...(input.contextCommitments ?? []), hyperEvmLendingGuardCommitment(decision)] })
  guardScope(intent, decision, now)
  return intent
}
export async function verifyHyperEvmLendingGuardAuthorizationBinding(authorization: Authorization | unknown, decisionValue: unknown, options: HyperEvmLendingGuardVerificationOptions = {}): Promise<{ valid: boolean; reason: string }> {
  const decision = asDecision(decisionValue)
  if (!decision || !isRecord(authorization) || !isRecord(authorization.intent) || !Number.isSafeInteger(authorization.issuedAt) || !Number.isSafeInteger(authorization.expiresAt)) return { valid: false, reason: 'MALFORMED' }
  const verification = await verifyInsightHyperEvmLendingGuardDecision(decision, { ...options, now: Number(authorization.issuedAt), allowHistorical: true })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') return { valid: false, reason: `INSIGHT_${verification.reason}` }
  try { guardScope(authorization.intent as Intent, decision, Number(authorization.issuedAt)); return Number(authorization.expiresAt) <= decision.attestation.data.validUntil ? { valid: true, reason: 'OK' } : { valid: false, reason: 'AUTHORIZATION_OUTLIVES_INSIGHT_DECISION' } } catch (error) { return { valid: false, reason: error instanceof Error ? error.message : 'BINDING_MISMATCH' } }
}
export async function verifyHyperEvmLendingGuardReceiptBundle(input: { receipt: Receipt | unknown; decision: unknown; priorSealTrust: LocalVerifierOptions; insightTrust: HyperEvmLendingGuardVerificationOptions }): Promise<{ valid: boolean; reason: string }> {
  const receiptResult = await verifyReceiptLocally(input.receipt, input.priorSealTrust)
  if (!receiptResult.valid || !isRecord(input.receipt) || !isRecord(input.receipt.authorizationEvidence)) return { valid: false, reason: `PRIORSEAL_${receiptResult.code}` }
  const binding = await verifyHyperEvmLendingGuardAuthorizationBinding(input.receipt.authorizationEvidence.authorization, input.decision, input.insightTrust)
  return binding.valid ? { valid: true, reason: 'OK' } : binding
}
