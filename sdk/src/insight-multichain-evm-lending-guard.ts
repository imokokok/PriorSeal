import { hashTypedData, keccak256, toBytes, verifyTypedData } from 'viem'
import type { KeyRegistry } from 'verify-insight-receipt'

import { matchUniqueContextCommitment } from './context-commitment.js'
import { buildExactCallIntent } from './exact-call.js'
import type { Authorization, ContextCommitment, ExactCallIntentInput, Intent, Receipt } from './types.js'
import { verifyReceiptLocally, type LocalVerifierOptions } from './verifier.js'

export const INSIGHT_MULTICHAIN_EVM_LENDING_GUARD_NAMESPACE = 'insight.multichain-evm-lending-guard.v1' as const
export const INSIGHT_MULTICHAIN_EVM_LENDING_GUARD_SCHEMA = 'insight.multichain-evm-lending-guard-decision.v1' as const
export const MULTICHAIN_EVM_LENDING_GUARD_INTENT_ASSET_PREFIX = 'lending:' as const
const DOMAIN = { name: 'Insight Multichain EVM Lending Guard', version: '1', chainId: 1 } as const
const TYPES = { MultichainEvmLendingGuardDecision: [
  { name: 'decisionHash', type: 'bytes32' }, { name: 'calldataHash', type: 'bytes32' },
  { name: 'account', type: 'address' }, { name: 'chainId', type: 'uint256' },
  { name: 'verdict', type: 'uint8' }, { name: 'issuedAt', type: 'uint256' },
  { name: 'validUntil', type: 'uint256' }, { name: 'schemaVersion', type: 'uint256' },
] } as const
const CHAINS = [137, 42161, 56, 8453] as const
const PROTOCOLS = [
  'aave-v3-polygon',
  'aave-v3-arbitrum',
  'aave-v3-bnb',
  'venus-core-bnb',
  'compound-v3-arbitrum',
  'morpho-blue-polygon',
  'morpho-blue-arbitrum',
  'lista-moolah-bnb',
  'euler-v2-base',
  'euler-v2-arbitrum',
  'dolomite-arbitrum',
  'fluid-vault-t1-base',
  'fluid-vault-t1-arbitrum',
] as const
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/
const UINT = /^(?:0|[1-9][0-9]*)$/
const LABEL = 'Insight Multichain EVM Lending Guard attester'
const VALID_FOR_SECONDS = 300
type GuardChain = (typeof CHAINS)[number]
type GuardProtocol = (typeof PROTOCOLS)[number]
type GuardVerificationOptions = { keyRegistry?: KeyRegistry; now?: number; allowHistorical?: boolean }

export type InsightMultichainEvmLendingGuardDecision = {
  schema: typeof INSIGHT_MULTICHAIN_EVM_LENDING_GUARD_SCHEMA
  guard: {
    schema: 'insight.multichain-evm-lending-guard.v1'; verdict: 'ALLOW' | 'CAUTION' | 'BLOCK'
    chainId: GuardChain; protocolId: GuardProtocol; action: 'supply' | 'borrow'
    scope: { chainId: GuardChain; [key: string]: unknown }
    market: { collateralSymbol: string; loanSymbol: string; [key: string]: unknown }
    [key: string]: unknown
  }
  transaction: { chainId: GuardChain; from: string; to: string; data: `0x${string}`; nonce: string | number; value: string | number }
  action: {
    protocolId: GuardProtocol; action: 'supply' | 'borrow'; target: string; calldataHash: `0x${string}`
    amount: string; account: string; receiver: string | null; asset: string | null; marketId: string | null
  }
  decisionHash: `0x${string}`
  attestation: {
    type: 'MultichainEvmLendingGuardDecision'; schemaVersion: 1; uid: `0x${string}`; attester: string
    attesterLabel: typeof LABEL; signedAt: string; validForSeconds: 300; signature: `0x${string}`; verifyUrl: string
    data: { decisionHash: `0x${string}`; calldataHash: `0x${string}`; account: string; chainId: GuardChain; verdict: 0 | 1 | 2; issuedAt: number; validUntil: number; schemaVersion: 1 }
    eip712: Record<string, unknown>
  } | null
}
export type InsightMultichainEvmLendingGuardVerification = {
  valid: boolean; signatureValid: boolean; trusted: boolean; expired: boolean; reason: string
  decisionHash: string | null; attester: string | null; issuedAt: number | null; validUntil: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('Multichain lending decision exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new TypeError('Multichain lending decision is too large')
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    if (keys.length > 20_000 || keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new TypeError('Unsafe multichain lending decision JSON')
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
  }
  throw new TypeError('Multichain lending decision is not canonical JSON')
}
function uint(value: unknown): string | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))) return null
  const result = String(value)
  return UINT.test(result) ? result : null
}
function verdictCode(value: string): 0 | 1 | 2 | null { return value === 'ALLOW' ? 0 : value === 'CAUTION' ? 1 : value === 'BLOCK' ? 2 : null }
function expectedChain(protocol: GuardProtocol): GuardChain {
  return protocol === 'aave-v3-polygon' || protocol === 'morpho-blue-polygon'
    ? 137
    : protocol === 'euler-v2-base' || protocol === 'fluid-vault-t1-base'
      ? 8453
      : protocol === 'aave-v3-arbitrum' || protocol === 'compound-v3-arbitrum' || protocol === 'morpho-blue-arbitrum' || protocol === 'euler-v2-arbitrum' || protocol === 'dolomite-arbitrum' || protocol === 'fluid-vault-t1-arbitrum'
      ? 42161
      : 56
}
function requiresMarketId(protocol: GuardProtocol): boolean {
  return protocol === 'morpho-blue-polygon' || protocol === 'morpho-blue-arbitrum' || protocol === 'lista-moolah-bnb'
}
function requiresMarketAddress(protocol: GuardProtocol): boolean {
  return protocol === 'euler-v2-base' || protocol === 'euler-v2-arbitrum' || protocol === 'fluid-vault-t1-base' || protocol === 'fluid-vault-t1-arbitrum'
}
function requiresDolomiteScope(protocol: GuardProtocol): boolean {
  return protocol === 'dolomite-arbitrum'
}
const DOLOMITE_ARBITRUM_MARGIN = '0x6bd780e7fdf01d77e4d475c821f1e7ae05409072'
function validDolomiteScope(action: InsightMultichainEvmLendingGuardDecision['action'], market: Record<string, unknown>): boolean {
  return action.target.toLowerCase() === DOLOMITE_ARBITRUM_MARGIN &&
    ['collateralMarketId', 'loanMarketId', 'accountNumber'].every((key) => UINT.test(String(market[key])))
}
const EULER_EVCS: Partial<Record<GuardProtocol, string>> = {
  'euler-v2-base': '0x5301c7dd20bd945d2013b48ed0dee3a284ca8989',
  'euler-v2-arbitrum': '0x6302ef0f34100cddfb5489fbcb6ee1aa95cd1066',
}
function validVaultActionScope(protocol: GuardProtocol, action: InsightMultichainEvmLendingGuardDecision['action'], market: Record<string, unknown>): boolean {
  if (!requiresMarketAddress(protocol) || !ADDRESS.test(String(market.marketAddress))) return false
  if (protocol === 'fluid-vault-t1-base' || protocol === 'fluid-vault-t1-arbitrum') {
    return action.action === 'supply' && action.target.toLowerCase() === String(market.marketAddress).toLowerCase()
  }
  if (action.action === 'supply') return action.target.toLowerCase() === String(market.marketAddress).toLowerCase()
  const evc = EULER_EVCS[protocol]
  return ADDRESS.test(String(market.collateralVaultAddress)) && !!evc && action.target.toLowerCase() === evc
}
function validVerificationUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value))
    return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      !url.username && !url.password && !url.hash && url.pathname === '/api/v1/safety/multichain-evm-lending-guard/verify'
  } catch { return false }
}
function registryTrust(registry: KeyRegistry | undefined, address: string, issuedAt: number): boolean {
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
function asDecision(value: unknown): InsightMultichainEvmLendingGuardDecision | null {
  if (!isRecord(value) || value.schema !== INSIGHT_MULTICHAIN_EVM_LENDING_GUARD_SCHEMA || !isRecord(value.guard) || !isRecord(value.transaction) || !isRecord(value.action) || !isRecord(value.attestation)) return null
  return value as unknown as InsightMultichainEvmLendingGuardDecision
}
function unsignedDecision(decision: InsightMultichainEvmLendingGuardDecision) {
  return { schema: decision.schema, guard: decision.guard, transaction: decision.transaction, action: decision.action }
}

export function multichainEvmLendingGuardCommitment(decision: Pick<InsightMultichainEvmLendingGuardDecision, 'decisionHash'>): ContextCommitment {
  if (!HEX32.test(decision.decisionHash)) throw new TypeError('Multichain lending decision hash must be 32-byte hex')
  return { namespace: INSIGHT_MULTICHAIN_EVM_LENDING_GUARD_NAMESPACE, algorithm: 'keccak256', digest: decision.decisionHash.toLowerCase() as `0x${string}` }
}
export function multichainEvmLendingGuardIntentAsset(chainId: GuardChain, protocolId: GuardProtocol): string {
  return `eip155:${chainId}/${MULTICHAIN_EVM_LENDING_GUARD_INTENT_ASSET_PREFIX}${protocolId}`
}

/** Verify Insight signature, key-registry epoch, canonical decision, and exact-call scope. */
export async function verifyInsightMultichainEvmLendingGuardDecision(value: unknown, options: GuardVerificationOptions = {}): Promise<InsightMultichainEvmLendingGuardVerification> {
  const empty = { valid: false, signatureValid: false, trusted: false, expired: false, reason: 'MALFORMED', decisionHash: null, attester: null, issuedAt: null, validUntil: null } as const
  try {
    const decision = asDecision(value)
    if (!decision || !decision.attestation) return { ...empty, reason: 'MISSING_OR_MALFORMED_ATTESTATION' }
    const { guard, transaction, action, attestation } = decision
    const data = attestation.data
    const nonce = uint(transaction.nonce), valueString = uint(transaction.value), expectedVerdict = verdictCode(guard.verdict)
    if (guard.schema !== 'insight.multichain-evm-lending-guard.v1' || !CHAINS.includes(guard.chainId) || !PROTOCOLS.includes(guard.protocolId) || expectedChain(guard.protocolId) !== guard.chainId || !['supply', 'borrow'].includes(guard.action) || !isRecord(guard.scope) || guard.scope.chainId !== guard.chainId || !isRecord(guard.market) || typeof guard.market.collateralSymbol !== 'string' || typeof guard.market.loanSymbol !== 'string' ||
      transaction.chainId !== guard.chainId || !ADDRESS.test(transaction.from) || !ADDRESS.test(transaction.to) || !/^0x(?:[0-9a-fA-F]{2})*$/.test(transaction.data) || nonce === null || valueString === null ||
      action.protocolId !== guard.protocolId || action.action !== guard.action || !ADDRESS.test(action.target) || action.target.toLowerCase() !== transaction.to.toLowerCase() || !HEX32.test(action.calldataHash) || action.calldataHash.toLowerCase() !== keccak256(transaction.data).toLowerCase() || !UINT.test(action.amount) || !ADDRESS.test(action.account) || action.account.toLowerCase() !== transaction.from.toLowerCase() || (action.receiver !== null && (!ADDRESS.test(action.receiver) || action.receiver.toLowerCase() !== transaction.from.toLowerCase())) || (action.asset !== null && !ADDRESS.test(action.asset)) || (action.marketId !== null && !HEX32.test(action.marketId)) || (requiresMarketId(guard.protocolId) && (!HEX32.test(String(guard.market.marketId)) || action.marketId?.toLowerCase() !== String(guard.market.marketId).toLowerCase())) || (!requiresMarketId(guard.protocolId) && action.marketId !== null) || (requiresMarketAddress(guard.protocolId) && !validVaultActionScope(guard.protocolId, action, guard.market)) || (requiresDolomiteScope(guard.protocolId) && !validDolomiteScope(action, guard.market)) || (!requiresMarketAddress(guard.protocolId) && (guard.market.marketAddress !== null && guard.market.marketAddress !== undefined || guard.market.collateralVaultAddress !== null && guard.market.collateralVaultAddress !== undefined)) ||
      !HEX32.test(decision.decisionHash) || !HEX32.test(data.decisionHash) || !HEX32.test(data.calldataHash) || !ADDRESS.test(data.account) || data.chainId !== guard.chainId || data.verdict !== expectedVerdict || !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.validUntil) || data.schemaVersion !== 1 ||
      attestation.type !== 'MultichainEvmLendingGuardDecision' || attestation.schemaVersion !== 1 || attestation.attesterLabel !== LABEL || !HEX32.test(attestation.uid) || !ADDRESS.test(attestation.attester) || !SIGNATURE.test(attestation.signature) || !validVerificationUrl(attestation.verifyUrl) || attestation.validForSeconds !== VALID_FOR_SECONDS || attestation.signedAt !== new Date(data.issuedAt * 1000).toISOString() || data.validUntil - data.issuedAt !== VALID_FOR_SECONDS || canonicalJson(attestation.eip712) !== canonicalJson({ domain: DOMAIN, types: TYPES, primaryType: 'MultichainEvmLendingGuardDecision' })) return { ...empty, reason: 'MALFORMED' }
    const decisionHash = keccak256(toBytes(canonicalJson(unsignedDecision(decision))))
    if (decisionHash.toLowerCase() !== decision.decisionHash.toLowerCase() || decisionHash.toLowerCase() !== data.decisionHash.toLowerCase() || data.calldataHash.toLowerCase() !== action.calldataHash.toLowerCase() || data.account.toLowerCase() !== action.account.toLowerCase()) return { ...empty, reason: 'DECISION_HASH_OR_CALL_BINDING_MISMATCH', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const typedData = { domain: DOMAIN, types: TYPES, primaryType: 'MultichainEvmLendingGuardDecision' as const, message: { decisionHash: data.decisionHash, calldataHash: data.calldataHash, account: data.account as `0x${string}`, chainId: BigInt(data.chainId), verdict: data.verdict, issuedAt: BigInt(data.issuedAt), validUntil: BigInt(data.validUntil), schemaVersion: 1n } }
    if (hashTypedData(typedData).toLowerCase() !== attestation.uid.toLowerCase()) return { ...empty, reason: 'UID_MISMATCH', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const signatureValid = await verifyTypedData({ ...typedData, address: attestation.attester as `0x${string}`, signature: attestation.signature })
    if (!signatureValid) return { ...empty, reason: 'SIGNATURE_INVALID', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const trusted = registryTrust(options.keyRegistry, attestation.attester, data.issuedAt)
    if (!trusted) return { ...empty, signatureValid: true, reason: 'SIGNER_UNTRUSTED', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const expired = data.validUntil <= (options.now ?? Math.floor(Date.now() / 1000))
    const valid = options.allowHistorical ? data.validUntil > data.issuedAt : !expired
    return { valid, signatureValid: true, trusted: true, expired, reason: valid ? 'OK' : 'EXPIRED', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
  } catch { return { ...empty, reason: 'VERIFICATION_ERROR' } }
}

function guardScope(intent: Intent, decision: InsightMultichainEvmLendingGuardDecision, now: number): void {
  const attestation = decision.attestation
  if (!attestation || intent.schema !== 'priorseal.intent.v2' || intent.executionProfile !== 'priorseal.execution-profile.exact-call.v1' || intent.action !== 'CONTRACT_CALL' || intent.asset !== multichainEvmLendingGuardIntentAsset(decision.guard.chainId, decision.guard.protocolId) || intent.amount !== decision.action.amount || Number(intent.chainId) !== decision.guard.chainId || intent.sender.toLowerCase() !== decision.transaction.from.toLowerCase() || intent.callTarget?.toLowerCase() !== decision.transaction.to.toLowerCase() || intent.recipient.toLowerCase() !== decision.transaction.to.toLowerCase() || intent.calldataHash?.toLowerCase() !== decision.action.calldataHash.toLowerCase() || intent.transactionValue !== String(decision.transaction.value) || intent.nonce !== String(decision.transaction.nonce) || !Number.isSafeInteger(intent.validUntil) || intent.validUntil > attestation.data.validUntil || now >= intent.validUntil) throw new Error('MULTICHAIN_EVM_LENDING_GUARD_CALL_SCOPE_MISMATCH')
  if (!matchUniqueContextCommitment(intent, multichainEvmLendingGuardCommitment(decision)).matched) throw new Error('MULTICHAIN_EVM_LENDING_GUARD_CONTEXT_COMMITMENT_MISMATCH')
}

/** Build the sole exact-call PriorSeal intent allowed by a verified Insight ALLOW. */
export async function buildMultichainEvmLendingGuardBoundIntent(input: ExactCallIntentInput, decisionValue: unknown, options: GuardVerificationOptions = {}): Promise<Intent> {
  input = structuredClone(input)
  const decision = asDecision(structuredClone(decisionValue))
  if (!decision) throw new TypeError('MULTICHAIN_EVM_LENDING_GUARD_MALFORMED')
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const verification = await verifyInsightMultichainEvmLendingGuardDecision(decision, { ...options, now })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') throw new TypeError(`MULTICHAIN_EVM_LENDING_GUARD_BLOCKED:${verification.reason}`)
  if (input.contextCommitments?.some((entry) => entry.namespace.toLowerCase() === INSIGHT_MULTICHAIN_EVM_LENDING_GUARD_NAMESPACE)) throw new TypeError('MULTICHAIN_EVM_LENDING_GUARD_RESERVED_NAMESPACE')
  if (input.asset !== multichainEvmLendingGuardIntentAsset(decision.guard.chainId, decision.guard.protocolId) || String(input.amount) !== decision.action.amount || canonicalJson(input.transaction) !== canonicalJson(decision.transaction)) throw new TypeError('MULTICHAIN_EVM_LENDING_GUARD_INPUT_SCOPE_MISMATCH')
  const intent = buildExactCallIntent({ ...input, validUntil: Math.min(input.validUntil, decision.attestation.data.validUntil), contextCommitments: [...(input.contextCommitments ?? []), multichainEvmLendingGuardCommitment(decision)] })
  guardScope(intent, decision, now)
  return intent
}
export async function verifyMultichainEvmLendingGuardAuthorizationBinding(authorization: Authorization | unknown, decisionValue: unknown, options: GuardVerificationOptions = {}): Promise<{ valid: boolean; reason: string }> {
  const decision = asDecision(decisionValue)
  if (!decision || !isRecord(authorization) || !isRecord(authorization.intent) || !Number.isSafeInteger(authorization.issuedAt) || !Number.isSafeInteger(authorization.expiresAt)) return { valid: false, reason: 'MALFORMED' }
  const verification = await verifyInsightMultichainEvmLendingGuardDecision(decision, { ...options, now: Number(authorization.issuedAt), allowHistorical: true })
  if (!verification.valid || !decision.attestation || decision.guard.verdict !== 'ALLOW') return { valid: false, reason: `INSIGHT_${verification.reason}` }
  try {
    guardScope(authorization.intent as Intent, decision, Number(authorization.issuedAt))
    if (Number(authorization.expiresAt) > decision.attestation.data.validUntil) return { valid: false, reason: 'AUTHORIZATION_OUTLIVES_INSIGHT_DECISION' }
    return { valid: true, reason: 'OK' }
  } catch (error) { return { valid: false, reason: error instanceof Error ? error.message : 'BINDING_MISMATCH' } }
}
export async function verifyMultichainEvmLendingGuardReceiptBundle(input: { receipt: Receipt | unknown; decision: unknown; priorSealTrust: LocalVerifierOptions; insightTrust: GuardVerificationOptions }): Promise<{ valid: boolean; reason: string }> {
  const receiptResult = await verifyReceiptLocally(input.receipt, input.priorSealTrust)
  if (!receiptResult.valid || !isRecord(input.receipt) || !isRecord(input.receipt.authorizationEvidence)) return { valid: false, reason: `PRIORSEAL_${receiptResult.code}` }
  const binding = await verifyMultichainEvmLendingGuardAuthorizationBinding(input.receipt.authorizationEvidence.authorization, input.decision, input.insightTrust)
  return binding.valid ? { valid: true, reason: 'OK' } : binding
}
