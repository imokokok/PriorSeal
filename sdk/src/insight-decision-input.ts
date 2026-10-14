import { encodeAbiParameters, hashTypedData, keccak256, toBytes, verifyTypedData } from 'viem'
import type { KeyRegistry, RoutableAttestation } from 'verify-insight-receipt'

export type InsightDecisionInputPolicy = {
  policyId: string
  version: string
  assetIds: Record<string, string>
  maxReferenceDeviationBps: number
  maxSlippageBps: number
  maxQuoteAgeSeconds: number
}

export type InsightSwapRiskPolicy = {
  policyId: string
  version: string
  deployments: Array<{ chainId: number; routerAddress: string; routerCodeHash: string }>
  maxBlockAgeSeconds: number
  maxTradeAmountDeviationBps: number
}

export type InsightDecisionInputAssessment = {
  schemaVersion: 1
  status: 'SUFFICIENT' | 'BLOCK' | 'INSUFFICIENT_EVIDENCE'
  eligibleToProceed: boolean
  asset: string
  chainId: number
  action: 'swap' | 'borrow' | 'lend' | 'liquidate' | 'repay'
  tradeAmountUsd: number
  evaluatedAt: string
  operationRouteQuote: Record<string, unknown> | null
  quoteInputHash: string
  policy: { maxReferenceDeviationBps: number; maxSlippageBps: number; maxQuoteAgeSeconds: number }
  prices: Record<string, unknown>
  evidence: Record<string, unknown>
  reasons: Array<{ code: string; severity: string; message: string }>
  caveats: string[]
  attestation: Record<string, unknown>
}

export type DecisionInputVerification = {
  valid: boolean
  signatureValid: boolean
  trusted: boolean
  expired: boolean
  reason: string
  uid: string | null
  assessmentHash: string | null
  linkedPreTradeUid: string | null
  issuedAt: number | null
  validUntil: number | null
}

export const INSIGHT_DECISION_INPUT_PAIR_NAMESPACE = 'insight.decision-input-pair.v1'
const DOMAIN = { name: 'Insight Decision Input Assessment', version: '1', chainId: 1 } as const
const TYPES = {
  DecisionInputAssessment: [
    { name: 'assessmentHash', type: 'bytes32' },
    { name: 'linkedPreTradeUid', type: 'bytes32' },
    { name: 'verifyUrlHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'schemaVersion', type: 'uint256' },
  ],
} as const
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/
const VALID_FOR_SECONDS = 300
const ATTESTATION_LABEL = 'Insight Decision Input Assessment attester'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('Decision Input exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new TypeError('Decision Input is too large')
    return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    if (keys.length > 20_000 || keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new TypeError('Unsafe Decision Input JSON')
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
  }
  throw new TypeError('Decision Input is not canonical JSON')
}

function validVerificationUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      !url.username && !url.password && !url.hash && url.pathname === '/api/v1/safety/decision-input/verify'
  } catch {
    return false
  }
}

export function isInsightDecisionInputPolicy(policy: unknown): policy is InsightDecisionInputPolicy {
  if (!isRecord(policy) || typeof policy.policyId !== 'string' || !policy.policyId.trim() || typeof policy.version !== 'string' || !policy.version.trim()) return false
  if (!isRecord(policy.assetIds) || Object.keys(policy.assetIds).length < 2 || Object.keys(policy.assetIds).length > 100) return false
  const normalizedLabels = new Set<string>()
  if (Object.entries(policy.assetIds).some(([label, id]) => {
    const normalized = label.trim().toUpperCase()
    if (!normalized || normalizedLabels.has(normalized) || typeof id !== 'string' || !/^eip155:[1-9][0-9]*\/erc20:0x[0-9a-fA-F]{40}$/.test(id)) return true
    normalizedLabels.add(normalized)
    return false
  })) return false
  return Number.isSafeInteger(policy.maxReferenceDeviationBps) && Number(policy.maxReferenceDeviationBps) >= 0 && Number(policy.maxReferenceDeviationBps) <= 10_000 &&
    Number.isSafeInteger(policy.maxSlippageBps) && Number(policy.maxSlippageBps) >= 0 && Number(policy.maxSlippageBps) <= 10_000 &&
    Number.isSafeInteger(policy.maxQuoteAgeSeconds) && Number(policy.maxQuoteAgeSeconds) >= 1 && Number(policy.maxQuoteAgeSeconds) <= 300
}

export function isInsightSwapRiskPolicy(policy: unknown): policy is InsightSwapRiskPolicy {
  if (!isRecord(policy) || typeof policy.policyId !== 'string' || !policy.policyId.trim() || typeof policy.version !== 'string' || !policy.version.trim() ||
    !Array.isArray(policy.deployments) || policy.deployments.length < 1 || policy.deployments.length > 100 ||
    !Number.isSafeInteger(policy.maxBlockAgeSeconds) || Number(policy.maxBlockAgeSeconds) < 1 || Number(policy.maxBlockAgeSeconds) > 300 ||
    !Number.isSafeInteger(policy.maxTradeAmountDeviationBps) || Number(policy.maxTradeAmountDeviationBps) < 0 || Number(policy.maxTradeAmountDeviationBps) > 10_000) return false
  const deployments = new Set<string>()
  for (const deployment of policy.deployments) {
    if (!isRecord(deployment) || !Number.isSafeInteger(deployment.chainId) || Number(deployment.chainId) < 1 ||
      typeof deployment.routerAddress !== 'string' || !ADDRESS.test(deployment.routerAddress) ||
      typeof deployment.routerCodeHash !== 'string' || !HEX32.test(deployment.routerCodeHash)) return false
    const key = `${deployment.chainId}:${deployment.routerAddress.toLowerCase()}`
    if (deployments.has(key)) return false
    deployments.add(key)
  }
  return true
}

function policyMatches(assessment: InsightDecisionInputAssessment, policy: InsightDecisionInputPolicy): boolean {
  return assessment.policy.maxReferenceDeviationBps === policy.maxReferenceDeviationBps &&
    assessment.policy.maxSlippageBps === policy.maxSlippageBps &&
    assessment.policy.maxQuoteAgeSeconds === policy.maxQuoteAgeSeconds
}

function policyDigest(policy: InsightDecisionInputPolicy): `0x${string}` {
  return keccak256(toBytes(canonicalJson({
    policyId: policy.policyId,
    version: policy.version,
    assetIds: policy.assetIds,
    maxReferenceDeviationBps: policy.maxReferenceDeviationBps,
    maxSlippageBps: policy.maxSlippageBps,
    maxQuoteAgeSeconds: policy.maxQuoteAgeSeconds,
  })))
}

function validKeyRegistry(registry: KeyRegistry): boolean {
  if (!isRecord(registry) || (registry.public_keys && registry.keys) || (registry.revoked_keys && registry.revoked)) return false
  const keys = registry.public_keys ?? registry.keys
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100) return false
  const ids = new Set<string>(), addresses = new Set<string>()
  for (const key of keys) {
    if (!isRecord(key) || typeof key.key_id !== 'string' || !key.key_id || typeof key.public_key !== 'string' || !ADDRESS.test(key.public_key) ||
      typeof key.revoked !== 'boolean' || (key.role !== undefined && !['attester', 'sample'].includes(String(key.role))) ||
      typeof key.validFrom !== 'string' || !Number.isFinite(Date.parse(key.validFrom)) ||
      (key.validUntil !== null && (typeof key.validUntil !== 'string' || !Number.isFinite(Date.parse(key.validUntil))))) return false
    if (ids.has(key.key_id) || addresses.has(key.public_key.toLowerCase())) return false
    ids.add(key.key_id); addresses.add(key.public_key.toLowerCase())
    if (key.validUntil !== null && Date.parse(key.validUntil as string) < Date.parse(key.validFrom)) return false
  }
  const revoked = registry.revoked_keys ?? registry.revoked ?? []
  return Array.isArray(revoked) && revoked.length <= 100 && revoked.every(entry => isRecord(entry) && typeof entry.key_id === 'string' && entry.key_id.length > 0)
}

function registryTrust(registry: KeyRegistry, address: string, issuedAt: number): boolean {
  if (!validKeyRegistry(registry)) return false
  const keys = registry.public_keys ?? registry.keys ?? []
  const matches = keys.filter(key => typeof key?.public_key === 'string' && key.public_key.toLowerCase() === address.toLowerCase())
  if (matches.length !== 1) return false
  const key = matches[0]
  if (key.revoked !== false || (key.role !== undefined && key.role !== 'attester') || typeof key.key_id !== 'string') return false
  const validFrom = Date.parse(String(key.validFrom)) / 1000
  const validUntil = key.validUntil === null ? null : Date.parse(String(key.validUntil)) / 1000
  if (!Number.isFinite(validFrom) || (validUntil !== null && !Number.isFinite(validUntil)) || issuedAt < validFrom || (validUntil !== null && issuedAt >= validUntil)) return false
  const revoked = registry.revoked_keys ?? registry.revoked ?? []
  return !revoked.some(entry => entry.key_id === key.key_id)
}

/** Verify Insight's v1 signed assessment using only the caller's independent registry and policy. */
export async function verifyInsightDecisionInputAssessment(
  value: unknown,
  options: { keyRegistry?: KeyRegistry; policy?: InsightDecisionInputPolicy; now?: number; allowHistorical?: boolean } = {},
): Promise<DecisionInputVerification> {
  const empty = { valid: false, signatureValid: false, trusted: false, expired: false, reason: 'MALFORMED', uid: null, assessmentHash: null, linkedPreTradeUid: null, issuedAt: null, validUntil: null } as const
  try {
    if (!isRecord(value) || !isRecord(value.attestation)) return { ...empty, reason: 'MISSING_OR_MALFORMED_ATTESTATION' }
    const assessment = value as unknown as InsightDecisionInputAssessment
    const proof = value.attestation
    const data = proof.data
    if (!isRecord(data) || assessment.schemaVersion !== 1 || !['SUFFICIENT', 'BLOCK', 'INSUFFICIENT_EVIDENCE'].includes(assessment.status) || assessment.eligibleToProceed !== (assessment.status === 'SUFFICIENT') ||
      typeof assessment.asset !== 'string' || !assessment.asset.trim() || !Number.isSafeInteger(assessment.chainId) || assessment.chainId < 0 || assessment.action !== 'swap' ||
      !Number.isFinite(assessment.tradeAmountUsd) || assessment.tradeAmountUsd <= 0 || typeof assessment.evaluatedAt !== 'string' || !Number.isFinite(Date.parse(assessment.evaluatedAt)) ||
      !HEX32.test(assessment.quoteInputHash) || !isRecord(assessment.policy) || !isRecord(assessment.prices) || !isRecord(assessment.evidence) ||
      !Array.isArray(assessment.reasons) || assessment.reasons.some(reason => !isRecord(reason) || typeof reason.code !== 'string' || !['block', 'insufficient_evidence'].includes(String(reason.severity)) || typeof reason.message !== 'string') || !Array.isArray(assessment.caveats) || assessment.caveats.some(item => typeof item !== 'string') || !(assessment.operationRouteQuote === null || isRecord(assessment.operationRouteQuote)) ||
      typeof assessment.prices.decisionPriceUsd !== 'number' || !Number.isFinite(assessment.prices.decisionPriceUsd) || assessment.prices.decisionPriceUsd <= 0 ||
      typeof assessment.prices.quotePriceUsd !== 'number' || !Number.isFinite(assessment.prices.quotePriceUsd) || assessment.prices.quotePriceUsd <= 0 ||
      typeof assessment.prices.quoteObservedAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(assessment.prices.quoteObservedAt) || !Number.isFinite(Date.parse(assessment.prices.quoteObservedAt)) ||
      !(assessment.prices.quoteAgeSeconds === null || (typeof assessment.prices.quoteAgeSeconds === 'number' && Number.isFinite(assessment.prices.quoteAgeSeconds) && assessment.prices.quoteAgeSeconds >= 0)) ||
      !(assessment.prices.quoteDeviationBps === null || (typeof assessment.prices.quoteDeviationBps === 'number' && Number.isFinite(assessment.prices.quoteDeviationBps) && assessment.prices.quoteDeviationBps >= 0)) ||
      !Number.isSafeInteger(assessment.policy.maxReferenceDeviationBps) || Number(assessment.policy.maxReferenceDeviationBps) < 0 || Number(assessment.policy.maxReferenceDeviationBps) > 10_000 || !Number.isSafeInteger(assessment.policy.maxSlippageBps) || Number(assessment.policy.maxSlippageBps) < 0 || Number(assessment.policy.maxSlippageBps) > 10_000 || !Number.isSafeInteger(assessment.policy.maxQuoteAgeSeconds) || Number(assessment.policy.maxQuoteAgeSeconds) < 1 || Number(assessment.policy.maxQuoteAgeSeconds) > 300 ||
      proof.type !== 'DecisionInputAssessment' || proof.schemaVersion !== 1 || proof.attesterLabel !== ATTESTATION_LABEL || typeof proof.uid !== 'string' || !HEX32.test(proof.uid) || typeof proof.attester !== 'string' || !ADDRESS.test(proof.attester) ||
      typeof proof.signature !== 'string' || !SIGNATURE.test(proof.signature) || typeof proof.verifyUrl !== 'string' || !validVerificationUrl(proof.verifyUrl) || !isRecord(proof.eip712) ||
      !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.validUntil) || data.schemaVersion !== 1 || !HEX32.test(String(data.assessmentHash)) || !HEX32.test(String(data.linkedPreTradeUid)) || !HEX32.test(String(data.verifyUrlHash)) ||
      proof.validForSeconds !== VALID_FOR_SECONDS || Number(data.validUntil) - Number(data.issuedAt) !== VALID_FOR_SECONDS || proof.signedAt !== new Date(Number(data.issuedAt) * 1000).toISOString() ||
      keccak256(toBytes(proof.verifyUrl)).toLowerCase() !== String(data.verifyUrlHash).toLowerCase() ||
      canonicalJson(proof.eip712) !== canonicalJson({ domain: DOMAIN, types: TYPES, primaryType: 'DecisionInputAssessment' })) return { ...empty, reason: 'MALFORMED' }

    const expectedQuoteAge = (Date.parse(assessment.evaluatedAt) - Date.parse(assessment.prices.quoteObservedAt)) / 1000
    const expectedQuoteDeviation = Math.abs(assessment.prices.quotePriceUsd - assessment.prices.decisionPriceUsd) / assessment.prices.decisionPriceUsd * 10_000
    if ((assessment.prices.quoteAgeSeconds !== null && (expectedQuoteAge < 0 || Math.abs(assessment.prices.quoteAgeSeconds - expectedQuoteAge) > 0.001)) ||
      (assessment.prices.quoteDeviationBps !== null && Math.abs(assessment.prices.quoteDeviationBps - expectedQuoteDeviation) > 0.001) ||
      (assessment.status === 'SUFFICIENT' && (assessment.prices.quoteAgeSeconds === null || assessment.prices.quoteDeviationBps === null || expectedQuoteAge < 0 || expectedQuoteAge > assessment.policy.maxQuoteAgeSeconds || expectedQuoteDeviation > assessment.policy.maxSlippageBps))) return { ...empty, reason: 'MALFORMED' }

    const { attestation: _proof, ...unsigned } = assessment
    const canonical = canonicalJson(unsigned)
    if (new TextEncoder().encode(canonical).byteLength > 256 * 1024) return { ...empty, reason: 'ASSESSMENT_TOO_LARGE' }
    const digest = keccak256(toBytes(canonical))
    if (digest.toLowerCase() !== String(data.assessmentHash).toLowerCase()) return { ...empty, reason: 'ASSESSMENT_HASH_MISMATCH', assessmentHash: digest, uid: String(proof.uid), linkedPreTradeUid: String(data.linkedPreTradeUid), issuedAt: Number(data.issuedAt), validUntil: Number(data.validUntil) }
    if (!options.policy || !isInsightDecisionInputPolicy(options.policy) || !policyMatches(assessment, options.policy)) return { ...empty, reason: 'POLICY_MISMATCH', assessmentHash: digest, uid: String(proof.uid), linkedPreTradeUid: String(data.linkedPreTradeUid), issuedAt: Number(data.issuedAt), validUntil: Number(data.validUntil) }
    const typedData = { domain: DOMAIN, types: TYPES, primaryType: 'DecisionInputAssessment' as const, message: { assessmentHash: String(data.assessmentHash) as `0x${string}`, linkedPreTradeUid: String(data.linkedPreTradeUid) as `0x${string}`, verifyUrlHash: String(data.verifyUrlHash) as `0x${string}`, issuedAt: BigInt(Number(data.issuedAt)), validUntil: BigInt(Number(data.validUntil)), schemaVersion: BigInt(Number(data.schemaVersion)) } }
    const uid = hashTypedData(typedData)
    if (uid.toLowerCase() !== String(proof.uid).toLowerCase()) return { ...empty, reason: 'UID_MISMATCH', uid, assessmentHash: digest, linkedPreTradeUid: String(data.linkedPreTradeUid), issuedAt: Number(data.issuedAt), validUntil: Number(data.validUntil) }
    const signatureValid = await verifyTypedData({ ...typedData, address: String(proof.attester) as `0x${string}`, signature: String(proof.signature) as `0x${string}` })
    if (!signatureValid) return { ...empty, reason: 'SIGNATURE_INVALID', uid, assessmentHash: digest, linkedPreTradeUid: String(data.linkedPreTradeUid), issuedAt: Number(data.issuedAt), validUntil: Number(data.validUntil) }
    const trusted = Boolean(options.keyRegistry && registryTrust(options.keyRegistry, String(proof.attester), Number(data.issuedAt)))
    if (!trusted) return { ...empty, signatureValid: true, reason: 'SIGNER_UNTRUSTED', uid, assessmentHash: digest, linkedPreTradeUid: String(data.linkedPreTradeUid), issuedAt: Number(data.issuedAt), validUntil: Number(data.validUntil) }
    const now = options.now ?? Math.floor(Date.now() / 1000)
    const expired = Number(data.validUntil) <= now
    const valid = options.allowHistorical ? Number(data.validUntil) > Number(data.issuedAt) : !expired
    return { valid, signatureValid: true, trusted: true, expired, reason: valid ? 'OK' : 'EXPIRED', uid, assessmentHash: digest, linkedPreTradeUid: String(data.linkedPreTradeUid), issuedAt: Number(data.issuedAt), validUntil: Number(data.validUntil) }
  } catch {
    return { ...empty, reason: 'VERIFICATION_ERROR' }
  }
}

/** Cross-check both DITs against signed source/destination pre-trade attestations. */
export async function verifyInsightDecisionInputPair(
  sourceValue: unknown,
  destinationValue: unknown,
  sourcePreTrade: RoutableAttestation,
  destinationPreTrade: RoutableAttestation,
  options: { keyRegistry?: KeyRegistry; policy?: InsightDecisionInputPolicy; issuedAt: number; expiresAt: number },
) {
  const source = await verifyInsightDecisionInputAssessment(sourceValue, { ...options, now: options.issuedAt })
  const destination = await verifyInsightDecisionInputAssessment(destinationValue, { ...options, now: options.issuedAt })
  if (!source.valid || !destination.valid || !source.uid || !destination.uid || !source.assessmentHash || !destination.assessmentHash || !source.validUntil || !destination.validUntil) throw new TypeError('Decision Input signatures or policy are invalid')
  if (source.issuedAt === null || destination.issuedAt === null || source.issuedAt > options.issuedAt || destination.issuedAt > options.issuedAt) throw new TypeError('Decision Input evidence was issued after the PriorSeal authorization')
  if (options.expiresAt > Math.min(source.validUntil, destination.validUntil)) throw new TypeError('Authorization outlives Decision Input evidence')
  if (source.linkedPreTradeUid?.toLowerCase() !== sourcePreTrade.uid.toLowerCase() || destination.linkedPreTradeUid?.toLowerCase() !== destinationPreTrade.uid.toLowerCase()) throw new TypeError('Decision Input is linked to a different pre-trade proof')
  const sourceAssessment = sourceValue as InsightDecisionInputAssessment
  const destinationAssessment = destinationValue as InsightDecisionInputAssessment
  const quoteAssessments = [sourceAssessment, destinationAssessment]
  const quoteDeadlines = quoteAssessments.map(assessment => Math.floor(
    Date.parse(String(assessment.prices.quoteObservedAt)) / 1000 + options.policy!.maxQuoteAgeSeconds,
  ))
  const quoteFreshAtAuthorization = quoteAssessments.every(assessment => {
    const observedAt = Date.parse(String(assessment.prices.quoteObservedAt))
    const signedAge = (Date.parse(assessment.evaluatedAt) - observedAt) / 1000
    const reportedAge = Number(assessment.prices.quoteAgeSeconds)
    const quoteDeviation = Number(assessment.prices.quoteDeviationBps)
    const expectedDeviation = Math.abs(
      Number(assessment.prices.quotePriceUsd) - Number(assessment.prices.decisionPriceUsd),
    ) / Number(assessment.prices.decisionPriceUsd) * 10_000
    const ageAtAuthorization = (options.issuedAt * 1000 - observedAt) / 1000
    return assessment.status === 'SUFFICIENT' && assessment.eligibleToProceed === true &&
      typeof assessment.prices.quoteAgeSeconds === 'number' &&
      typeof assessment.prices.quoteDeviationBps === 'number' &&
      Math.abs(signedAge - reportedAge) <= 0.001 &&
      Math.abs(expectedDeviation - quoteDeviation) <= 0.001 &&
      reportedAge <= options.policy!.maxQuoteAgeSeconds &&
      quoteDeviation <= options.policy!.maxSlippageBps &&
      ageAtAuthorization >= -5 && ageAtAuthorization <= options.policy!.maxQuoteAgeSeconds
  })
  if (!quoteFreshAtAuthorization || options.expiresAt > Math.min(...quoteDeadlines)) throw new TypeError('Decision Input quote is stale or authorization outlives its freshness window')
  const sourceData = sourcePreTrade.data as Record<string, unknown>
  const destinationData = destinationPreTrade.data as Record<string, unknown>
  const preTradeSourceAssetId = String(sourceData.sourceAssetId ?? '')
  const preTradeDestinationAssetId = String(sourceData.destinationAssetId ?? '')
  const sourceAssetChainId = /^eip155:([1-9][0-9]*)\/erc20:0x[0-9a-fA-F]{40}$/.exec(preTradeSourceAssetId)?.[1]
  const destinationAssetChainId = /^eip155:([1-9][0-9]*)\/erc20:0x[0-9a-fA-F]{40}$/.exec(preTradeDestinationAssetId)?.[1]
  const resolve = (asset: string) => {
    const normalized = asset.trim().toUpperCase()
    const matches = Object.entries(options.policy?.assetIds ?? {}).filter(([label]) => label.trim().toUpperCase() === normalized)
    return matches.length === 1 ? matches[0][1] : undefined
  }
  const scopesMatch = sourceAssessment.status === 'SUFFICIENT' && sourceAssessment.eligibleToProceed === true && destinationAssessment.status === 'SUFFICIENT' && destinationAssessment.eligibleToProceed === true &&
    typeof sourceData.subjectChainId === 'number' && Number.isSafeInteger(sourceData.subjectChainId) && sourceData.subjectChainId > 0 && sourceData.subjectChainId === destinationData.subjectChainId &&
    preTradeSourceAssetId.startsWith(`eip155:${sourceData.subjectChainId}/`) && preTradeDestinationAssetId.startsWith(`eip155:${sourceData.subjectChainId}/`) &&
    String(sourceData.action).toLowerCase() === 'swap' && sourceData.action === destinationData.action && sourceData.tradeAmountUsd === destinationData.tradeAmountUsd &&
    sourceAssessment.chainId === Number(sourceData.subjectChainId) && destinationAssessment.chainId === Number(destinationData.subjectChainId) &&
    sourceAssessment.action === 'swap' && destinationAssessment.action === 'swap' &&
    sourceAssessment.tradeAmountUsd === Number(sourceData.tradeAmountUsd) && destinationAssessment.tradeAmountUsd === Number(destinationData.tradeAmountUsd) &&
    sourceAssetChainId === String(sourceData.subjectChainId) && destinationAssetChainId === String(sourceData.subjectChainId) &&
    resolve(sourceAssessment.asset)?.toLowerCase() === preTradeSourceAssetId.toLowerCase() && resolve(destinationAssessment.asset)?.toLowerCase() === preTradeDestinationAssetId.toLowerCase() &&
    String(destinationData.sourceAssetId).toLowerCase() === preTradeDestinationAssetId.toLowerCase() && String(destinationData.destinationAssetId).toLowerCase() === preTradeSourceAssetId.toLowerCase()
  const preTradeTimesValid = [sourceData, destinationData].every(data => Number.isSafeInteger(data.checkedAt) && Number.isSafeInteger(data.validUntil) && Number(data.checkedAt) <= options.issuedAt && Number(data.validUntil) >= options.expiresAt)
  if (!scopesMatch || !preTradeTimesValid) throw new TypeError('Decision Input assessments do not match the live signed pre-trade asset pair and trade scope')
  const digest = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
    [source.uid as `0x${string}`, destination.uid as `0x${string}`, source.assessmentHash as `0x${string}`, destination.assessmentHash as `0x${string}`, source.linkedPreTradeUid as `0x${string}`, destination.linkedPreTradeUid as `0x${string}`, policyDigest(options.policy!)],
  ))
  return { namespace: INSIGHT_DECISION_INPUT_PAIR_NAMESPACE, algorithm: 'keccak256' as const, digest }
}
