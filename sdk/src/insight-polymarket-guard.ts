import { hashTypedData, keccak256, toBytes, verifyTypedData } from 'viem'
import type { KeyRegistry } from 'verify-insight-receipt'

import type { ContextCommitment } from './types.js'

export const INSIGHT_POLYMARKET_GUARD_NAMESPACE = 'insight.polymarket-guard.v1' as const
export const INSIGHT_POLYMARKET_GUARD_DECISION_SCHEMA = 'insight.polymarket-guard-decision.v1' as const
export const INSIGHT_POLYMARKET_GUARD_DOMAIN = { name: 'Insight Polymarket Guard', version: '1', chainId: 1 } as const
export const INSIGHT_POLYMARKET_GUARD_TYPES = { PolymarketGuardDecision: [
  { name: 'assessmentHash', type: 'bytes32' }, { name: 'protocolId', type: 'string' },
  { name: 'marketSlug', type: 'string' }, { name: 'action', type: 'string' },
  { name: 'verdict', type: 'uint8' }, { name: 'issuedAt', type: 'uint256' },
  { name: 'validUntil', type: 'uint256' }, { name: 'schemaVersion', type: 'uint256' },
] } as const

const HASH = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/
const LABEL = 'Insight Polymarket Guard attester'
const MAX_VALIDITY_SECONDS = 60

export type InsightPolymarketGuardDecision = {
  schema: typeof INSIGHT_POLYMARKET_GUARD_DECISION_SCHEMA
  guard: Record<string, unknown> & {
    schema: 'insight.polymarket-guard.v1'
    protocolId: 'polymarket-prediction-mainnet'
    action: 'buy_up' | 'buy_down'
    verdict: 'ALLOW' | 'CAUTION' | 'BLOCK'
    scope: { transactionAuthority: 'none'; [key: string]: unknown }
    market: { marketSlug: string; [key: string]: unknown }
    timing: { evaluatedAtMs: number; [key: string]: unknown }
    next: { execution: 'not_performed'; [key: string]: unknown }
  }
  decisionHash: `0x${string}`
  attestation: {
    type: 'PolymarketGuardDecision'; schemaVersion: 1; uid: `0x${string}`; attester: string
    attesterLabel: typeof LABEL; signedAt: string; validForSeconds: 60; signature: `0x${string}`
    data: { assessmentHash: `0x${string}`; protocolId: 'polymarket-prediction-mainnet'; marketSlug: string
      action: 'buy_up' | 'buy_down'; verdict: 0 | 1 | 2; issuedAt: number; validUntil: number; schemaVersion: 1 }
    eip712: Record<string, unknown>
  }
}

export type InsightPolymarketGuardVerification = {
  valid: boolean; signatureValid: boolean; trusted: boolean; expired: boolean; reason: string
  decisionHash: string | null; attester: string | null; issuedAt: number | null; validUntil: number | null
}
export type InsightPolymarketGuardVerificationOptions = { keyRegistry?: KeyRegistry; now?: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('Polymarket guard exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    if (keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new TypeError('Unsafe Polymarket guard JSON')
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
  }
  throw new TypeError('Polymarket guard is not canonical JSON')
}
function registryTrust(registry: KeyRegistry | undefined, address: string, issuedAt: number): boolean {
  if (!registry || !isRecord(registry) || (registry.public_keys && registry.keys) || (registry.revoked_keys && registry.revoked)) return false
  const keys = registry.public_keys ?? registry.keys
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100) return false
  const matches = keys.filter((entry) => isRecord(entry) && typeof entry.public_key === 'string' && entry.public_key.toLowerCase() === address.toLowerCase())
  if (matches.length !== 1) return false
  const key = matches[0]
  if (key.revoked !== false || (key.role !== undefined && key.role !== 'attester') || typeof key.key_id !== 'string' || typeof key.validFrom !== 'string' || !Number.isFinite(Date.parse(key.validFrom)) || (key.validUntil !== null && (typeof key.validUntil !== 'string' || !Number.isFinite(Date.parse(key.validUntil))))) return false
  if (issuedAt < Date.parse(key.validFrom) / 1000 || (key.validUntil !== null && issuedAt >= Date.parse(key.validUntil) / 1000)) return false
  const revoked = registry.revoked_keys ?? registry.revoked ?? []
  return Array.isArray(revoked) && !revoked.some((entry) => isRecord(entry) && entry.key_id === key.key_id)
}
function parseDecision(value: unknown): InsightPolymarketGuardDecision | null {
  const root = isRecord(value) && value.success === true && isRecord(value.data) ? value.data : value
  if (!isRecord(root) || root.schema !== INSIGHT_POLYMARKET_GUARD_DECISION_SCHEMA || !isRecord(root.guard) || !isRecord(root.attestation)) return null
  return root as unknown as InsightPolymarketGuardDecision
}

export function insightPolymarketGuardCommitment(decision: Pick<InsightPolymarketGuardDecision, 'decisionHash'>): ContextCommitment {
  if (!HASH.test(decision.decisionHash)) throw new TypeError('Polymarket guard decision hash must be 32-byte hex')
  return { namespace: INSIGHT_POLYMARKET_GUARD_NAMESPACE, algorithm: 'keccak256', digest: decision.decisionHash.toLowerCase() as `0x${string}` }
}

/** Verify the complete signed read-only assessment and its issuer key epoch. */
export async function verifyInsightPolymarketGuardDecision(value: unknown, options: InsightPolymarketGuardVerificationOptions = {}): Promise<InsightPolymarketGuardVerification> {
  const empty = { valid: false, signatureValid: false, trusted: false, expired: false, reason: 'MALFORMED', decisionHash: null, attester: null, issuedAt: null, validUntil: null } as const
  try {
    const decision = parseDecision(value)
    if (!decision) return empty
    const { guard, attestation } = decision
    const data = attestation.data
    const verdict = guard.verdict === 'ALLOW' ? 0 : guard.verdict === 'CAUTION' ? 1 : guard.verdict === 'BLOCK' ? 2 : -1
    if (guard.schema !== 'insight.polymarket-guard.v1' || guard.protocolId !== 'polymarket-prediction-mainnet' ||
      !['buy_up', 'buy_down'].includes(guard.action) || guard.scope?.transactionAuthority !== 'none' ||
      guard.next?.execution !== 'not_performed' || typeof guard.market?.marketSlug !== 'string' || !guard.market.marketSlug ||
      guard.market.marketSlug.length > 200 || !Number.isSafeInteger(guard.timing?.evaluatedAtMs) || guard.timing.evaluatedAtMs < 0 || !HASH.test(decision.decisionHash) ||
      attestation.type !== 'PolymarketGuardDecision' || attestation.schemaVersion !== 1 || attestation.attesterLabel !== LABEL ||
      !HASH.test(attestation.uid) || !ADDRESS.test(attestation.attester) || !SIGNATURE.test(attestation.signature) ||
      attestation.validForSeconds !== MAX_VALIDITY_SECONDS || !data || !HASH.test(data.assessmentHash) ||
      data.protocolId !== guard.protocolId || data.marketSlug !== guard.market.marketSlug || data.action !== guard.action ||
      data.verdict !== verdict || data.schemaVersion !== 1 || !Number.isSafeInteger(data.issuedAt) || data.issuedAt < 0 ||
      !Number.isSafeInteger(data.validUntil) || data.validUntil < 0 || data.validUntil <= data.issuedAt ||
      data.validUntil - data.issuedAt > MAX_VALIDITY_SECONDS || attestation.signedAt !== new Date(data.issuedAt * 1000).toISOString() ||
      canonicalJson(attestation.eip712) !== canonicalJson({ domain: INSIGHT_POLYMARKET_GUARD_DOMAIN, types: INSIGHT_POLYMARKET_GUARD_TYPES, primaryType: 'PolymarketGuardDecision' })) return empty

    const decisionHash = keccak256(toBytes(canonicalJson(guard)))
    if (decisionHash.toLowerCase() !== decision.decisionHash.toLowerCase() || decisionHash.toLowerCase() !== data.assessmentHash.toLowerCase()) return { ...empty, reason: 'ASSESSMENT_HASH_MISMATCH' }
    const assessedAt = Math.floor(guard.timing.evaluatedAtMs / 1000)
    if (data.issuedAt < assessedAt || data.validUntil > assessedAt + MAX_VALIDITY_SECONDS) return { ...empty, reason: 'ASSESSMENT_STALE' }
    const typedData = { domain: INSIGHT_POLYMARKET_GUARD_DOMAIN, types: INSIGHT_POLYMARKET_GUARD_TYPES, primaryType: 'PolymarketGuardDecision' as const,
      message: { assessmentHash: data.assessmentHash, protocolId: data.protocolId, marketSlug: data.marketSlug, action: data.action,
        verdict: data.verdict, issuedAt: BigInt(data.issuedAt), validUntil: BigInt(data.validUntil), schemaVersion: 1n } }
    if (hashTypedData(typedData).toLowerCase() !== attestation.uid.toLowerCase()) return { ...empty, reason: 'UID_MISMATCH' }
    const signatureValid = await verifyTypedData({ ...typedData, address: attestation.attester as `0x${string}`, signature: attestation.signature })
    if (!signatureValid) return { ...empty, reason: 'SIGNATURE_INVALID' }
    if (!registryTrust(options.keyRegistry, attestation.attester, data.issuedAt)) return { ...empty, signatureValid: true, reason: 'SIGNER_UNTRUSTED', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
    const now = options.now ?? Math.floor(Date.now() / 1000)
    const expired = data.validUntil <= now
    const issuedInFuture = data.issuedAt > now + 5
    const valid = !expired && !issuedInFuture
    return { valid, signatureValid: true, trusted: true, expired, reason: valid ? 'OK' : expired ? 'EXPIRED' : 'ISSUED_IN_FUTURE', decisionHash, attester: attestation.attester, issuedAt: data.issuedAt, validUntil: data.validUntil }
  } catch { return { ...empty, reason: 'VERIFICATION_ERROR' } }
}
