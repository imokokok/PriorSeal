import { decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toFunctionSelector, type Hex, type PublicClient } from 'viem'
import type { KeyRegistry as InsightKeyRegistry, RoutableAttestation } from 'verify-insight-receipt'
import type { InsightProtocolTrust, InsightProtocolResult } from './insight-protocol-trust.js'
import { hashJson } from './verifier-core.js'
import { verifyVerificationBundleLocally, type LocalVerifierOptions, type LocalVerificationResult } from './verifier.js'
import { matchUniqueContextCommitment } from './context-commitment.js'
import {
  isInsightDecisionInputPolicy,
  isInsightSwapRiskPolicy,
  verifyInsightDecisionInputPair,
  verifyInsightDecisionInputAssessment,
  type InsightDecisionInputAssessment,
  type InsightDecisionInputPolicy,
  type InsightSwapRiskPolicy,
} from './insight-decision-input.js'
import type { KeyEntry, VerificationBundle } from './types.js'

export type TrustProfile = {
  schema: 'priorseal.trust-profile.v1'
  id?: string
  name?: string
  issuer: string
  audience: string
  keys: KeyEntry[]
  source: string
  confirmedAt: number
  insightKeyRegistry?: InsightKeyRegistry
  insightProtocolTrust?: InsightProtocolTrust
  insightDecisionInputPolicy?: InsightDecisionInputPolicy
  insightSwapRiskPolicy?: InsightSwapRiskPolicy
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Parsing never confers trust: the caller must confirm the source independently. */
export function parseTrustProfile(input: unknown): TrustProfile {
  if (!isRecord(input) || input.schema !== 'priorseal.trust-profile.v1' || typeof input.issuer !== 'string' || !input.issuer.trim() || typeof input.audience !== 'string' || !input.audience.trim() || typeof input.source !== 'string' || !input.source.trim() || !Number.isSafeInteger(input.confirmedAt) || Number(input.confirmedAt) < 0 || !Array.isArray(input.keys) || !input.keys.length || input.keys.length > 100 || (input.name !== undefined && typeof input.name !== 'string') || (input.id !== undefined && typeof input.id !== 'string')) throw new TypeError('Invalid trust profile')
  const p = input as TrustProfile
  const ids = new Set<string>()
  for (const key of p.keys) {
    if (!isRecord(key) || key.issuer !== p.issuer || typeof key.keyId !== 'string' || !key.keyId || ids.has(key.keyId) || key.algorithm !== 'Ed25519' || typeof key.publicKey !== 'string' || !key.publicKey.includes('BEGIN PUBLIC KEY') || typeof key.status !== 'string' || !['active', 'retired', 'revoked'].includes(key.status)) throw new TypeError('Invalid or ambiguous trust key')
    ids.add(key.keyId)
    for (const time of [key.validFrom, key.validUntil]) if (time !== null && (!Number.isSafeInteger(time) || Number(time) < 0)) throw new TypeError('Invalid key time window')
    if (key.validFrom !== null && key.validUntil !== null && key.validFrom > key.validUntil) throw new TypeError('Invalid key time window')
  }
  if (p.insightKeyRegistry) validateInsightKeyRegistry(p.insightKeyRegistry)
  if (p.insightDecisionInputPolicy !== undefined && !isInsightDecisionInputPolicy(p.insightDecisionInputPolicy)) throw new TypeError('Invalid Insight Decision Input policy profile')
  if (p.insightSwapRiskPolicy !== undefined && !isInsightSwapRiskPolicy(p.insightSwapRiskPolicy)) throw new TypeError('Invalid Insight swap risk policy profile')
  // Shape/size checks here do not confer protocol trust. The protocol verifier
  // checks exact bytes, content addresses and policy lineage when evidence is reviewed.
  if (p.insightProtocolTrust !== undefined && (!p.insightProtocolTrust || typeof p.insightProtocolTrust !== 'object' || Array.isArray(p.insightProtocolTrust) || new TextEncoder().encode(JSON.stringify(p.insightProtocolTrust)).length > 2 * 1024 * 1024)) throw new TypeError('Invalid Insight protocol trust evidence')
  return structuredClone(p)
}

export type ReviewAttachmentInput = { id: string; role: string; profile: string; rawJson: string }
export type ReviewAttachment = ReviewAttachmentInput & { sha256: string }
export type ReviewManifest = {
  schema: 'priorseal.review-manifest.v1'
  bundle: VerificationBundle
  attachments: ReviewAttachment[]
  expectedTxHash: string | null
  assembledAt: number
  manifestHash: string
}
export type ReviewArtifactResult = { id: string; role: string; profile: string; integrityValid: boolean; signatureValid: boolean | null; trusted: boolean | null; code: string; authority?: 'signed' | 'unsigned_advisory'; protocol?: InsightProtocolResult }
export type ReviewResult = {
  valid: boolean
  code: string
  verificationOrigin: 'local'
  priorSeal: LocalVerificationResult
  artifacts: ReviewArtifactResult[]
  relations: { transaction: boolean | null; insightPair: boolean | null; insightAuthorizationBinding: boolean | null; insightDecisionInputPair: boolean | null; insightDecisionInputAuthorizationBinding: boolean | null; insightTransactionRiskBinding: boolean | null; insightProtocol: boolean | null }
  requiredExternalChecks: LocalVerificationResult['requiredExternalChecks']
  unverified: string[]
}
export type InsightSwapRiskChainReader = {
  getChainId(): Promise<number>
  getBlock(input: { blockNumber: bigint }): Promise<{ number: bigint | null; timestamp: bigint; hash: Hex | null }>
  getBytecode(input: { address: Hex; blockNumber: bigint }): Promise<Hex | undefined>
  readContract(input: { address: Hex; abi: typeof ERC20_DECIMALS_ABI; functionName: 'decimals'; blockNumber: bigint }): Promise<unknown>
  call(input: { account: Hex; to: Hex; data: Hex; value: bigint; blockNumber: bigint }): Promise<{ data?: Hex }>
}
export type InsightSwapRiskChainReplay = {
  valid: boolean
  code: string
  chainId: number | null
  blockNumber: string | null
  blockHash: string | null
}
export type ReviewManifestChainResult = {
  valid: boolean
  code: string
  verificationOrigin: 'local+chain'
  localReview: ReviewResult
  insightSwapRiskReplay: InsightSwapRiskChainReplay | null
}

const roles = new Set(['insight.source', 'insight.destination', 'insight.execution', 'insight.decision-input.source', 'insight.decision-input.destination', 'insight.swap-transaction-risk'])
const decisionInputRoles = new Set(['insight.decision-input.source', 'insight.decision-input.destination'])
const transactionRiskRole = 'insight.swap-transaction-risk'
const txHashPattern = /^0x[0-9a-fA-F]{64}$/
const MAX_ATTACHMENT_BYTES = 512 * 1024

type InsightSwapRiskTransaction = {
  chainId: number
  from: string
  router: string
  calldataHash: string
  inputToken: string
  outputToken: string
  calldata: string
  recipient: string
  fee: number
  deadline: number
  amountIn: string
  amountOutMinimum: string
  callProfile?: 'UNISWAP_V3_SWAP_ROUTER' | 'UNISWAP_V3_SWAP_ROUTER02_DEADLINE_MULTICALL'
}

type InsightSwapRiskEvidence = {
  blockNumber: string
  blockHash: string
  blockTimestamp: number
  routerCodeHash: string
  sourceAttestationUid: string
  destinationAttestationUid: string
  simulatedAmountOut: string
  oracleExpectedAmountOut: string
  actualTradeAmountUsdMicros: string
  assessedTradeAmountUsdMicros: string
  oracleDeviationBps: number
  tradeAmountDeviationBps: number
  allowedSlippageBps: number
  decisionInputPair?: Record<string, unknown>
}

type InsightSwapRiskReport = {
  schema: 'insight.swap-transaction-risk.v1'
  status: 'ACCEPTABLE'
  reasonCodes: string[]
  transaction: InsightSwapRiskTransaction
  evidence: InsightSwapRiskEvidence
  validUntil: number
  signed: false
}

const INSIGHT_V3_SINGLE_SWAP_ABI = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
])
const INSIGHT_V3_ROUTER02_SINGLE_SWAP_ABI = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
])
const INSIGHT_V3_ROUTER02_MULTICALL_ABI = parseAbi([
  'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)',
])
const ORIGINAL_V3_SWAP_SELECTOR = toFunctionSelector('exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))')
const ROUTER02_MULTICALL_SELECTOR = toFunctionSelector('multicall(uint256,bytes[])')
const ROUTER02_SWAP_SELECTOR = toFunctionSelector('exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))')
type DecodedInsightRiskCall = {
  callProfile: NonNullable<InsightSwapRiskTransaction['callProfile']>
  params: { tokenIn: Hex; tokenOut: Hex; fee: number; recipient: Hex; amountIn: bigint; amountOutMinimum: bigint; sqrtPriceLimitX96: bigint }
  deadline: bigint
}

function decodeInsightRiskCall(calldata: Hex): DecodedInsightRiskCall {
  if (calldata.slice(0, 10).toLowerCase() === ORIGINAL_V3_SWAP_SELECTOR.toLowerCase()) {
    const decoded = decodeFunctionData({ abi: INSIGHT_V3_SINGLE_SWAP_ABI, data: calldata })
    if (decoded.functionName !== 'exactInputSingle' || encodeFunctionData({ abi: INSIGHT_V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: decoded.args }).toLowerCase() !== calldata.toLowerCase()) throw new TypeError('Noncanonical original V3 call')
    const params = decoded.args[0]
    return { callProfile: 'UNISWAP_V3_SWAP_ROUTER', params, deadline: params.deadline }
  }
  if (calldata.slice(0, 10).toLowerCase() !== ROUTER02_MULTICALL_SELECTOR.toLowerCase()) throw new TypeError('Unsupported V3 call')
  const decoded = decodeFunctionData({ abi: INSIGHT_V3_ROUTER02_MULTICALL_ABI, data: calldata })
  if (decoded.functionName !== 'multicall' || encodeFunctionData({ abi: INSIGHT_V3_ROUTER02_MULTICALL_ABI, functionName: 'multicall', args: decoded.args }).toLowerCase() !== calldata.toLowerCase()) throw new TypeError('Noncanonical Router02 multicall')
  const [deadline, calls] = decoded.args
  if (calls.length !== 1 || calls[0].slice(0, 10).toLowerCase() !== ROUTER02_SWAP_SELECTOR.toLowerCase()) throw new TypeError('Router02 multicall must contain one exactInputSingle call')
  const swap = decodeFunctionData({ abi: INSIGHT_V3_ROUTER02_SINGLE_SWAP_ABI, data: calls[0] })
  if (swap.functionName !== 'exactInputSingle' || encodeFunctionData({ abi: INSIGHT_V3_ROUTER02_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: swap.args }).toLowerCase() !== calls[0].toLowerCase()) throw new TypeError('Noncanonical Router02 exactInputSingle')
  return { callProfile: 'UNISWAP_V3_SWAP_ROUTER02_DEADLINE_MULTICALL', params: swap.args[0], deadline }
}

function decodeInsightRiskSimulation(callProfile: DecodedInsightRiskCall['callProfile'], data: Hex): bigint {
  if (callProfile === 'UNISWAP_V3_SWAP_ROUTER') return decodeFunctionResult({ abi: INSIGHT_V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', data })
  const results = decodeFunctionResult({ abi: INSIGHT_V3_ROUTER02_MULTICALL_ABI, functionName: 'multicall', data })
  if (results.length !== 1) throw new TypeError('Unexpected Router02 multicall result count')
  return decodeFunctionResult({ abi: INSIGHT_V3_ROUTER02_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', data: results[0] })
}
const ERC20_DECIMALS_ABI = parseAbi(['function decimals() view returns (uint8)'])

function validateSwapRiskReport(value: unknown): value is InsightSwapRiskReport {
  if (!isRecord(value) || value.schema !== 'insight.swap-transaction-risk.v1' || value.status !== 'ACCEPTABLE' || value.signed !== false ||
    !Array.isArray(value.reasonCodes) || value.reasonCodes.length !== 0 || !isRecord(value.transaction) || !isRecord(value.evidence) || !safeUnsigned(value.validUntil)) return false
  const tx = value.transaction, evidence = value.evidence
  const shapeValid = safeUnsigned(tx.chainId) && tx.chainId > 0 && typeof tx.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(tx.from) &&
    typeof tx.router === 'string' && /^0x[0-9a-fA-F]{40}$/.test(tx.router) && typeof tx.calldataHash === 'string' && txHashPattern.test(tx.calldataHash) &&
    typeof tx.inputToken === 'string' && /^0x[0-9a-fA-F]{40}$/.test(tx.inputToken) && typeof tx.outputToken === 'string' && /^0x[0-9a-fA-F]{40}$/.test(tx.outputToken) &&
    typeof tx.calldata === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(tx.calldata) && tx.calldata.length <= 131_074 &&
    typeof tx.recipient === 'string' && /^0x[0-9a-fA-F]{40}$/.test(tx.recipient) &&
    safeUnsigned(tx.fee) && tx.fee > 0 && tx.fee <= 0xffffff && safeUnsigned(tx.deadline) && tx.deadline > 0 &&
    (tx.callProfile === undefined || tx.callProfile === 'UNISWAP_V3_SWAP_ROUTER' || tx.callProfile === 'UNISWAP_V3_SWAP_ROUTER02_DEADLINE_MULTICALL') &&
    typeof tx.amountIn === 'string' && /^(0|[1-9][0-9]*)$/.test(tx.amountIn) && tx.amountIn.length <= 78 && BigInt(tx.amountIn) > 0n &&
    typeof tx.amountOutMinimum === 'string' && /^(0|[1-9][0-9]*)$/.test(tx.amountOutMinimum) && tx.amountOutMinimum.length <= 78 && BigInt(tx.amountOutMinimum) > 0n &&
    typeof evidence.blockNumber === 'string' && /^(0|[1-9][0-9]*)$/.test(evidence.blockNumber) && evidence.blockNumber.length <= 78 && typeof evidence.blockHash === 'string' && txHashPattern.test(evidence.blockHash) && safeUnsigned(evidence.blockTimestamp) &&
    typeof evidence.routerCodeHash === 'string' && txHashPattern.test(evidence.routerCodeHash) && typeof evidence.sourceAttestationUid === 'string' && txHashPattern.test(evidence.sourceAttestationUid) &&
    typeof evidence.destinationAttestationUid === 'string' && txHashPattern.test(evidence.destinationAttestationUid) &&
    ['simulatedAmountOut', 'oracleExpectedAmountOut', 'actualTradeAmountUsdMicros', 'assessedTradeAmountUsdMicros'].every(key => typeof evidence[key] === 'string' && /^(0|[1-9][0-9]*)$/.test(String(evidence[key])) && String(evidence[key]).length <= 78) &&
    ['oracleDeviationBps', 'tradeAmountDeviationBps', 'allowedSlippageBps'].every(key => safeUnsigned(evidence[key]))
  if (!shapeValid) return false
  try {
    const calldata = tx.calldata as string
    if (keccak256(calldata as Hex).toLowerCase() !== String(tx.calldataHash).toLowerCase()) return false
    const decoded = decodeInsightRiskCall(calldata as Hex)
    if (tx.callProfile !== undefined && tx.callProfile !== decoded.callProfile || Number(tx.deadline) !== Number(decoded.deadline)) return false
    const params = decoded.params
    const simulated = BigInt(String(evidence.simulatedAmountOut))
    const expected = BigInt(String(evidence.oracleExpectedAmountOut))
    const minimum = BigInt(String(tx.amountOutMinimum))
    const actualUsd = BigInt(String(evidence.actualTradeAmountUsdMicros))
    const assessedUsd = BigInt(String(evidence.assessedTradeAmountUsdMicros))
    const bps = (actual: bigint, baseline: bigint) => Number((((actual > baseline ? actual - baseline : baseline - actual) * 10_000n) / baseline) > 1_000_000n ? 1_000_000n : ((actual > baseline ? actual - baseline : baseline - actual) * 10_000n) / baseline)
    const outputDeviation = bps(simulated, expected)
    const amountDeviation = bps(actualUsd, assessedUsd)
    const slippage = simulated > minimum ? Number(((simulated - minimum) * 10_000n) / simulated) : 0
    return params.tokenIn.toLowerCase() === String(tx.inputToken).toLowerCase() &&
      params.tokenOut.toLowerCase() === String(tx.outputToken).toLowerCase() &&
      params.recipient.toLowerCase() === String(tx.recipient).toLowerCase() && params.fee === tx.fee &&
      params.amountIn === BigInt(String(tx.amountIn)) &&
      params.amountOutMinimum === minimum && params.sqrtPriceLimitX96 === 0n &&
      simulated >= minimum && expected > 0n && assessedUsd > 0n &&
      Number(evidence.oracleDeviationBps) === outputDeviation &&
      Number(evidence.tradeAmountDeviationBps) === amountDeviation &&
      Number(evidence.allowedSlippageBps) === slippage
  } catch {
    return false
  }
}

function stableRiskJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableRiskJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableRiskJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function validateInsightKeyRegistry(registry: InsightKeyRegistry) {
  if (!isRecord(registry) || (registry.public_keys && registry.keys) || (registry.revoked_keys && registry.revoked)) throw new TypeError('Ambiguous Insight key registry')
  const keys = registry.public_keys ?? registry.keys
  if (!Array.isArray(keys) || !keys.length || keys.length > 100) throw new TypeError('Invalid Insight key registry')
  const addresses = new Set<string>(), ids = new Set<string>()
  for (const key of keys) {
    if (!isRecord(key)) throw new TypeError('Invalid Insight trust key')
    const address = typeof key?.public_key === 'string' ? key.public_key.toLowerCase() : ''
    if (!/^0x[0-9a-f]{40}$/.test(address) || addresses.has(address) || typeof key.key_id !== 'string' || !key.key_id || ids.has(key.key_id) || typeof key.revoked !== 'boolean' || (key.role !== undefined && (typeof key.role !== 'string' || !['attester', 'sample'].includes(key.role))) || typeof key.validFrom !== 'string' || !Number.isFinite(Date.parse(key.validFrom)) || (key.validUntil !== null && (typeof key.validUntil !== 'string' || !Number.isFinite(Date.parse(key.validUntil)) || Date.parse(key.validUntil) < Date.parse(key.validFrom)))) throw new TypeError('Invalid or ambiguous Insight trust key')
    addresses.add(address); ids.add(key.key_id)
  }
  const revoked = registry.revoked_keys ?? registry.revoked ?? []
  if (!Array.isArray(revoked) || revoked.some(key => !key || typeof key.key_id !== 'string' || !key.key_id)) throw new TypeError('Invalid Insight revocation list')
}

const safeUnsigned = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0


function validateAttachments(attachments: ReviewAttachmentInput[]) {
  if (!Array.isArray(attachments) || attachments.length > 32) throw new TypeError('At most 32 evidence attachments are allowed')
  const ids = new Set<string>(), uniqueRoles = new Set<string>()
  for (const artifact of attachments) {
    if (!artifact || !/^[A-Za-z0-9._:-]{1,128}$/.test(artifact.id) || ids.has(artifact.id) || typeof artifact.profile !== 'string' || !artifact.profile || artifact.profile.length > 128 || typeof artifact.role !== 'string' || !artifact.role || artifact.role.length > 128 || typeof artifact.rawJson !== 'string' || new TextEncoder().encode(artifact.rawJson).length > MAX_ATTACHMENT_BYTES) throw new TypeError('Invalid evidence attachment')
    ids.add(artifact.id)
    if (roles.has(artifact.role)) {
      if (uniqueRoles.has(artifact.role)) throw new TypeError('Ambiguous evidence role')
      uniqueRoles.add(artifact.role)
    }
    JSON.parse(artifact.rawJson)
  }
}

async function hashBytes(raw: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

async function insightVerifier() {
  // The upstream package is CommonJS; browser bundlers can expose only `default`.
  const namespace = await import('verify-insight-receipt')
  return ((namespace as unknown as { default?: typeof namespace }).default ?? namespace)
}

/** Keeps original signed bytes alongside, never re-signs or upgrades their authority. */
export async function buildReviewManifest(input: { bundle: VerificationBundle; attachments?: ReviewAttachmentInput[]; expectedTxHash?: string; assembledAt?: number }): Promise<ReviewManifest> {
  const attachments = input.attachments ?? []
  validateAttachments(attachments)
  if (input.bundle?.schema !== 'priorseal.verification-bundle.v1') throw new TypeError('A native verification bundle is required')
  const expectedTxHash = input.expectedTxHash ?? input.bundle.receipt.execution.txHash ?? null
  if (expectedTxHash !== null && !txHashPattern.test(expectedTxHash)) throw new TypeError('Invalid expected transaction hash')
  const assembledAt = input.assembledAt ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(assembledAt) || assembledAt < 0) throw new TypeError('Invalid assembly time')
  const content = {
    schema: 'priorseal.review-manifest.v1' as const,
    bundle: structuredClone(input.bundle),
    attachments: await Promise.all(attachments.map(async item => ({ ...item, sha256: await hashBytes(item.rawJson) }))),
    expectedTxHash,
    assembledAt,
  }
  return { ...content, manifestHash: await hashJson(content) }
}

/** The manifest's keys are discovery metadata only. All verification uses caller trust. */
export async function verifyReviewManifestLocally(manifest: ReviewManifest, options: LocalVerifierOptions & { insightKeyRegistry?: InsightKeyRegistry; insightProtocolTrust?: InsightProtocolTrust; insightDecisionInputPolicy?: InsightDecisionInputPolicy; insightSwapRiskPolicy?: InsightSwapRiskPolicy } = {}): Promise<ReviewResult> {
  const empty: LocalVerificationResult = { valid: false, code: 'INVALID_REVIEW_MANIFEST', verificationScope: 'LOCAL_COMPLETE', requiredExternalChecks: [] }
  const result: ReviewResult = { valid: false, code: 'INVALID_REVIEW_MANIFEST', verificationOrigin: 'local', priorSeal: empty, artifacts: [], relations: { transaction: null, insightPair: null, insightAuthorizationBinding: null, insightDecisionInputPair: null, insightDecisionInputAuthorizationBinding: null, insightTransactionRiskBinding: null, insightProtocol: null }, requiredExternalChecks: [], unverified: [] }
  try {
    if (manifest?.schema !== 'priorseal.review-manifest.v1' || !Number.isSafeInteger(manifest.assembledAt) || manifest.assembledAt < 0 || !/^[0-9a-f]{64}$/.test(manifest.manifestHash) || (manifest.expectedTxHash !== null && !txHashPattern.test(manifest.expectedTxHash))) return result
    validateAttachments(manifest.attachments)
    const { manifestHash, ...content } = manifest
    if (await hashJson(content) !== manifestHash) return { ...result, code: 'MANIFEST_HASH_MISMATCH' }
    result.priorSeal = await verifyVerificationBundleLocally(manifest.bundle, options)
    result.requiredExternalChecks = result.priorSeal.requiredExternalChecks
    const proofs: Record<string, RoutableAttestation> = {}
    const decisionInputs: Record<string, InsightDecisionInputAssessment> = {}
    let transactionRiskReport: InsightSwapRiskReport | undefined
    const configuredSwapRiskPolicy = isInsightSwapRiskPolicy(options.insightSwapRiskPolicy) ? options.insightSwapRiskPolicy : undefined
    let registry = options.insightKeyRegistry
    try { if (registry) validateInsightKeyRegistry(registry) } catch { registry = undefined }
    const registryKeys = registry?.public_keys ?? registry?.keys ?? []
    for (const attachment of manifest.attachments) {
      const row: ReviewArtifactResult = { id: attachment.id, role: attachment.role, profile: attachment.profile, integrityValid: await hashBytes(attachment.rawJson) === attachment.sha256, signatureValid: null, trusted: null, code: 'UNSUPPORTED_VERIFIER_PROFILE' }
      result.artifacts.push(row)
      if (!row.integrityValid) { row.code = 'ARTIFACT_HASH_MISMATCH'; continue }
      if (decisionInputRoles.has(attachment.role)) {
        if (attachment.profile !== 'insight.decision-input.v1') { result.unverified.push(attachment.id); continue }
        const decisionInput = JSON.parse(attachment.rawJson) as InsightDecisionInputAssessment
        const verified = await verifyInsightDecisionInputAssessment(decisionInput, {
          keyRegistry: registry,
          policy: options.insightDecisionInputPolicy,
          allowHistorical: true,
        })
        row.signatureValid = verified.signatureValid
        row.trusted = verified.trusted
        row.code = verified.reason
        if (verified.valid && verified.trusted && verified.signatureValid) decisionInputs[attachment.role] = decisionInput
        else result.unverified.push(attachment.id)
        continue
      }
      if (attachment.role === transactionRiskRole) {
        row.authority = 'unsigned_advisory'
        if (attachment.profile !== 'insight.swap-transaction-risk.v1') { row.code = 'UNSUPPORTED_ADVISORY_PROFILE'; result.unverified.push(attachment.id); continue }
        const candidate: unknown = JSON.parse(attachment.rawJson)
        if (!validateSwapRiskReport(candidate)) { row.code = 'MALFORMED_UNSIGNED_ADVISORY'; result.unverified.push(attachment.id); continue }
        transactionRiskReport = candidate
        row.code = 'COMMITTED_UNSIGNED_ADVISORY'
        continue
      }
      if (!roles.has(attachment.role)) { result.unverified.push(attachment.id); continue }
      const proof = JSON.parse(attachment.rawJson) as RoutableAttestation
      const version = proof?.data?.schemaVersion
      if (!safeUnsigned(version) || (proof.schemaVersion !== undefined && proof.schemaVersion !== version)) { row.code = 'UNSUPPORTED_OR_INCONSISTENT_SCHEMA'; result.unverified.push(attachment.id); continue }
      const supported = roles.has(attachment.role) && (attachment.role === 'insight.execution' ? attachment.profile === `insight.execution.v${version}` && [2, 3, 4, 5].includes(version) : attachment.profile === `insight.pretrade.v${version}` && [2, 3].includes(version))
      if (!supported) { result.unverified.push(attachment.id); continue }
      const executionArtifact = attachment.role === 'insight.execution'
      const { verifyReceipt: verifyInsight } = await insightVerifier()
      const verified = executionArtifact
        ? await (await import('./insight-execution-v5.js')).verifyExecutionReceipt(proof, { keyRegistry: registry })
        : await verifyInsight(proof, { keyRegistry: registry })
      row.signatureValid = 'cryptographicValid' in verified ? verified.cryptographicValid : ['ok', 'expired'].includes(verified.code)
      const matches = registryKeys.filter(key => key.public_key.toLowerCase() === proof.attester?.toLowerCase())
      row.trusted = verified.keyStatus === 'valid' && matches.length === 1 && (matches[0].role === undefined || matches[0].role === 'attester')
      row.code = row.signatureValid ? row.trusted ? verified.expired ? 'HISTORICAL_SIGNATURE_VALID' : 'OK' : 'SIGNER_UNTRUSTED' : verified.code
      let protocolValid = true
      if (executionArtifact) {
        row.protocol = await (await import('./insight-protocol-trust.js')).evaluateInsightProtocolTrust(proof, options.insightProtocolTrust)
        protocolValid = row.protocol.valid
        result.relations.insightProtocol = protocolValid
        if (row.signatureValid && row.trusted && !protocolValid) row.code = row.protocol.code
      }
      if (row.signatureValid && row.trusted && protocolValid) proofs[attachment.role] = proof
    }
    const receipt = manifest.bundle.receipt
    const expected = receipt.execution.txHash?.toLowerCase()
    const execution = proofs['insight.execution']
    result.relations.transaction = Boolean(expected && txHashPattern.test(expected) && (!manifest.expectedTxHash || manifest.expectedTxHash.toLowerCase() === expected) && (!execution || (
      String(execution.data.txHash).toLowerCase() === expected &&
      safeUnsigned(execution.data.settlementChainId) && execution.data.settlementChainId === receipt.execution.chainId &&
      execution.data.settlementChainId === receipt.authorizationEvidence?.authorization.intent.chainId &&
      safeUnsigned(execution.data.executedAt) && execution.data.executedAt === receipt.execution.executedAt &&
      String(execution.data.taker).toLowerCase() === receipt.execution.sender?.toLowerCase() &&
      String(execution.data.taker).toLowerCase() === receipt.authorizationEvidence?.authorization.delegate.executor.toLowerCase()
    )))
    const source = proofs['insight.source'], destination = proofs['insight.destination']
    const hasInsight = manifest.attachments.some(attachment => roles.has(attachment.role))
    const commitsInsight = receipt.authorizationEvidence?.authorization.intent.contextCommitments?.some(c => c.namespace === 'insight.pretrade-pair.v1')
    if (hasInsight || commitsInsight) {
      if (!source || !destination || !execution) result.unverified.push('insight.complete_pair')
      if (source && destination && execution) {
        const { verifyExecutionPair } = await import('./insight-execution-v5.js')
        const pair = await verifyExecutionPair(source, execution, destination, { keyRegistry: registry })
        const checkedTimes = [source.data.checkedAt, destination.data.checkedAt]
        const timesValid = checkedTimes.every(safeUnsigned) &&
          [source.data.validUntil, destination.data.validUntil, execution.data.executedAt, execution.data.validUntil, execution.data.preTradeSignedAt, execution.data.attestationAgeAtExecSeconds].every(safeUnsigned) &&
          checkedTimes.every((time, index) => Number(time) <= Number([source, destination][index].data.validUntil)) &&
          execution.data.preTradeSignedAt === Math.max(...checkedTimes.map(Number)) &&
          Number(execution.data.executedAt) >= Number(execution.data.preTradeSignedAt) &&
          Number(execution.data.executedAt) <= Number(execution.data.validUntil) &&
          execution.data.attestationAgeAtExecSeconds === Number(execution.data.executedAt) - Number(execution.data.preTradeSignedAt)
        const subjectChainsValid = [source.data.subjectChainId, destination.data.subjectChainId, execution.data.subjectChainId].every(safeUnsigned)
        // A legacy single-sided C4 cannot establish this manifest's two-sided claim.
        result.relations.insightPair = timesValid && subjectChainsValid && Number(execution.data.schemaVersion) >= 3 &&
          String(execution.data.preTradeUid).toLowerCase() === source.uid.toLowerCase() &&
          String(execution.data.destinationPreTradeUid).toLowerCase() === destination.uid.toLowerCase() && pair.pairedValid
        const slippage = execution.data.maxSlippageBps
        if (!safeUnsigned(slippage) || slippage > 65535) return { ...result, code: 'EVIDENCE_RELATION_MISMATCH' }
        const commitment = { namespace: 'insight.pretrade-pair.v1', algorithm: 'keccak256' as const, digest: keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint16' }], [source.uid as `0x${string}`, destination.uid as `0x${string}`, source.data.requestHash as `0x${string}`, destination.data.requestHash as `0x${string}`, slippage])) }
        const authorization = receipt.authorizationEvidence?.authorization
        const inAuthorizationWindow = [source, destination].every(proof => authorization && safeUnsigned(proof.data.checkedAt) && safeUnsigned(proof.data.validUntil) && proof.data.checkedAt <= authorization.issuedAt && proof.data.validUntil >= authorization.expiresAt)
        result.relations.insightAuthorizationBinding = Boolean(authorization && inAuthorizationWindow && matchUniqueContextCommitment(authorization.intent, commitment).matched)
      }
    }
    const hasDecisionInput = manifest.attachments.some(attachment => decisionInputRoles.has(attachment.role))
    const authorization = receipt.authorizationEvidence?.authorization
    const commitsDecisionInput = authorization?.intent.contextCommitments?.some(commitment => commitment.namespace === 'insight.decision-input-pair.v1') === true
    if (hasDecisionInput || commitsDecisionInput) {
      const sourceDecisionInput = decisionInputs['insight.decision-input.source']
      const destinationDecisionInput = decisionInputs['insight.decision-input.destination']
      if (!sourceDecisionInput || !destinationDecisionInput || !source || !destination || !execution || !authorization) {
        result.relations.insightDecisionInputPair = false
        result.relations.insightDecisionInputAuthorizationBinding = false
        result.unverified.push('insight.decision-input.complete_pair')
      } else {
        try {
          const commitment = await verifyInsightDecisionInputPair(
            sourceDecisionInput,
            destinationDecisionInput,
            source,
            destination,
            {
              keyRegistry: registry,
              policy: options.insightDecisionInputPolicy,
              issuedAt: authorization.issuedAt,
              expiresAt: authorization.expiresAt,
            },
          )
          result.relations.insightDecisionInputPair = true
          const executionWithinInputPolicy = safeUnsigned(execution.data.maxSlippageBps) &&
            execution.data.maxSlippageBps <= (options.insightDecisionInputPolicy?.maxSlippageBps ?? -1)
          result.relations.insightDecisionInputAuthorizationBinding = executionWithinInputPolicy &&
            matchUniqueContextCommitment(authorization.intent, commitment).matched
          if (!result.relations.insightDecisionInputAuthorizationBinding) result.unverified.push('insight.decision-input.authorization_binding')
        } catch {
          result.relations.insightDecisionInputPair = false
          result.relations.insightDecisionInputAuthorizationBinding = false
          result.unverified.push('insight.decision-input.scope_or_policy_mismatch')
        }
      }
    }
    const commitsTransactionRisk = authorization?.intent.contextCommitments?.some(commitment => commitment.namespace === 'insight.swap-transaction-risk.v1') === true
    const hasTransactionRisk = manifest.attachments.some(attachment => attachment.role === transactionRiskRole)
    if (hasTransactionRisk || commitsTransactionRisk) {
      if (!transactionRiskReport || !authorization || !source || !destination || !decisionInputs['insight.decision-input.source'] || !decisionInputs['insight.decision-input.destination']) {
        result.relations.insightTransactionRiskBinding = false
        result.unverified.push('insight.transaction-risk.complete_binding')
      } else {
        const report = transactionRiskReport
        const tx = report.transaction
        const evidence = report.evidence
        const sourceDecision = decisionInputs['insight.decision-input.source']
        const destinationDecision = decisionInputs['insight.decision-input.destination']
        const sourceData = source.data as Record<string, unknown>
        const destinationData = destination.data as Record<string, unknown>
        const sourceDIAttestation = sourceDecision.attestation as Record<string, unknown>
        const destinationDIAttestation = destinationDecision.attestation as Record<string, unknown>
        const sourceDIData = sourceDIAttestation.data as Record<string, unknown>
        const destinationDIData = destinationDIAttestation.data as Record<string, unknown>
        const sourceAssetId = String(sourceData.sourceAssetId ?? '')
        const destinationAssetId = String(sourceData.destinationAssetId ?? '')
        const reportInputId = `eip155:${tx.chainId}/erc20:${String(tx.inputToken).toLowerCase()}`
        const reportOutputId = `eip155:${tx.chainId}/erc20:${String(tx.outputToken).toLowerCase()}`
        const pair = isRecord(evidence.decisionInputPair) ? evidence.decisionInputPair : null
        const swapRiskPolicy = configuredSwapRiskPolicy
        const approvedDeployment = swapRiskPolicy?.deployments.find(deployment => deployment.chainId === tx.chainId && deployment.routerAddress.toLowerCase() === String(tx.router).toLowerCase())
        const expectedRiskCommitment = { namespace: transactionRiskRole + '.v1', algorithm: 'keccak256' as const, digest: keccak256(new TextEncoder().encode(stableRiskJson(report))) }
        const exactRiskCommitment = matchUniqueContextCommitment(authorization.intent, expectedRiskCommitment).matched
        const decisionPairMatches = pair !== null &&
          String(pair.sourceUid).toLowerCase() === String(sourceDIAttestation.uid).toLowerCase() &&
          String(pair.destinationUid).toLowerCase() === String(destinationDIAttestation.uid).toLowerCase() &&
          String(pair.sourceAssessmentHash).toLowerCase() === String(sourceDIData.assessmentHash).toLowerCase() &&
          String(pair.destinationAssessmentHash).toLowerCase() === String(destinationDIData.assessmentHash).toLowerCase() &&
          String(pair.policyDigest).toLowerCase() === (authorization.intent.contextCommitments?.find(commitment => commitment.namespace === 'insight.decision-input-pair.v1')?.digest ?? '').toLowerCase()
        const exactTransactionMatches = Number(tx.chainId) === Number(authorization.intent.chainId) &&
          String(tx.from).toLowerCase() === String(authorization.intent.sender).toLowerCase() &&
          String(tx.router).toLowerCase() === String(authorization.intent.callTarget).toLowerCase() &&
          String(tx.calldataHash).toLowerCase() === String(authorization.intent.calldataHash).toLowerCase() &&
          approvedDeployment !== undefined && String(evidence.routerCodeHash).toLowerCase() === approvedDeployment.routerCodeHash.toLowerCase() &&
          reportInputId.toLowerCase() === sourceAssetId.toLowerCase() && reportOutputId.toLowerCase() === destinationAssetId.toLowerCase() &&
          String(evidence.sourceAttestationUid).toLowerCase() === source.uid.toLowerCase() && String(evidence.destinationAttestationUid).toLowerCase() === destination.uid.toLowerCase() &&
          safeUnsigned(evidence.blockTimestamp) && Number(evidence.blockTimestamp) <= authorization.issuedAt + 5 && authorization.issuedAt - Number(evidence.blockTimestamp) <= (swapRiskPolicy?.maxBlockAgeSeconds ?? -1) &&
          Number(report.validUntil) >= authorization.expiresAt &&
          Number(report.validUntil) <= Number(evidence.blockTimestamp) + Math.min(swapRiskPolicy?.maxBlockAgeSeconds ?? 0, options.insightDecisionInputPolicy?.maxQuoteAgeSeconds ?? 0) &&
          Number(evidence.oracleDeviationBps) <= (options.insightDecisionInputPolicy?.maxReferenceDeviationBps ?? -1) &&
          Number(evidence.allowedSlippageBps) <= (options.insightDecisionInputPolicy?.maxSlippageBps ?? -1) &&
          Number(evidence.tradeAmountDeviationBps) <= (swapRiskPolicy?.maxTradeAmountDeviationBps ?? -1)
        result.relations.insightTransactionRiskBinding = Boolean(exactRiskCommitment && exactTransactionMatches && decisionPairMatches)
        if (!result.relations.insightTransactionRiskBinding) result.unverified.push('insight.transaction-risk.authorization_or_scope_mismatch')
      }
    }
    const artifactsVerified = result.artifacts.every(row => row.integrityValid && (row.authority === 'unsigned_advisory'
      ? result.relations.insightTransactionRiskBinding === true
      : row.signatureValid === true && row.trusted === true && (!row.protocol || row.protocol.valid)))
    const relationsValid = Object.values(result.relations).every(value => value !== false)
    result.valid = result.priorSeal.valid && artifactsVerified && relationsValid && result.unverified.length === 0 && result.requiredExternalChecks.length === 0
    result.code = result.valid ? 'OK' : !result.priorSeal.valid ? result.priorSeal.code : !relationsValid ? 'EVIDENCE_RELATION_MISMATCH' : 'INCOMPLETE_VERIFICATION'
    return result
  } catch {
    return { ...result, valid: false, code: 'INVALID_REVIEW_MANIFEST' }
  }
}

function unsignedBigInt(value: unknown): bigint | null {
  try {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null
    if (typeof value !== 'number' && typeof value !== 'bigint' && (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value))) return null
    const parsed = BigInt(value)
    return parsed >= 0n && parsed < 2n ** 256n ? parsed : null
  } catch {
    return null
  }
}

function differenceBps(actual: bigint, expected: bigint): number {
  const difference = actual > expected ? actual - expected : expected - actual
  const result = (difference * 10_000n) / expected
  return Number(result > 1_000_000n ? 1_000_000n : result)
}

function replayFailure(code: string, chainId: number | null = null, blockNumber: string | null = null, blockHash: string | null = null): InsightSwapRiskChainReplay {
  return { valid: false, code, chainId, blockNumber, blockHash }
}

/** Replays Insight's exact pinned-block V3 checks using a caller-selected RPC reader.
 * The manifest must first pass verifyReviewManifestLocally with independently
 * obtained Insight keys and deployment policy. This function never broadcasts.
 */
export async function replayInsightSwapRiskOnChain(
  reportValue: unknown,
  sourceValue: unknown,
  destinationValue: unknown,
  reader: InsightSwapRiskChainReader,
): Promise<InsightSwapRiskChainReplay> {
  if (!validateSwapRiskReport(reportValue)) return replayFailure('INVALID_RISK_REPORT')
  if (!isRecord(sourceValue) || !isRecord(destinationValue) || !isRecord(sourceValue.data) || !isRecord(destinationValue.data)) return replayFailure('INVALID_PRETRADE_EVIDENCE')
  const report = reportValue
  const tx = report.transaction
  const evidence = report.evidence
  const sourceData = sourceValue.data
  const destinationData = destinationValue.data
  const blockNumber = BigInt(String(evidence.blockNumber))
  const sourcePrice = unsignedBigInt(sourceData.consensusPrice)
  const destinationPrice = unsignedBigInt(destinationData.consensusPrice)
  const assessedAmount = unsignedBigInt(sourceData.tradeAmountUsd)
  const destinationAssessedAmount = unsignedBigInt(destinationData.tradeAmountUsd)
  if (!sourcePrice || !destinationPrice || !assessedAmount || assessedAmount !== destinationAssessedAmount) return replayFailure('SIGNED_ORACLE_SCOPE_INVALID', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
  const sourceChain = safeUnsigned(sourceData.subjectChainId) ? Number(sourceData.subjectChainId) : null
  const destinationChain = safeUnsigned(destinationData.subjectChainId) ? Number(destinationData.subjectChainId) : null
  const sourceAssetId = String(sourceData.sourceAssetId ?? '')
  const destinationAssetId = String(sourceData.destinationAssetId ?? '')
  if (sourceChain !== tx.chainId || destinationChain !== tx.chainId ||
    `eip155:${tx.chainId}/erc20:${String(tx.inputToken).toLowerCase()}` !== sourceAssetId.toLowerCase() ||
    `eip155:${tx.chainId}/erc20:${String(tx.outputToken).toLowerCase()}` !== destinationAssetId.toLowerCase()) {
    return replayFailure('SIGNED_ASSET_SCOPE_MISMATCH', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
  }

  try {
    const chainId = await reader.getChainId()
    if (!Number.isSafeInteger(chainId) || chainId !== tx.chainId) return replayFailure('RPC_CHAIN_MISMATCH', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
    const block = await reader.getBlock({ blockNumber })
    if (block.number === null || block.number !== blockNumber || !block.hash || block.hash.toLowerCase() !== String(evidence.blockHash).toLowerCase() ||
      block.timestamp > BigInt(Number.MAX_SAFE_INTEGER) || Number(block.timestamp) !== Number(evidence.blockTimestamp)) {
      return replayFailure('PINNED_BLOCK_MISMATCH', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
    }
    const code = await reader.getBytecode({ address: tx.router as Hex, blockNumber })
    if (!code || code === '0x' || keccak256(code).toLowerCase() !== String(evidence.routerCodeHash).toLowerCase()) {
      return replayFailure('ROUTER_CODE_MISMATCH', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
    }
    const decoded = decodeInsightRiskCall(tx.calldata as Hex)
    if ((tx.callProfile !== undefined && tx.callProfile !== decoded.callProfile) || Number(tx.deadline) !== Number(decoded.deadline)) return replayFailure('UNSUPPORTED_SWAP_CALL', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
    const { params } = decoded
    const [sourceDecimalsValue, destinationDecimalsValue, simulation] = await Promise.all([
      reader.readContract({ address: params.tokenIn, abi: ERC20_DECIMALS_ABI, functionName: 'decimals', blockNumber }),
      reader.readContract({ address: params.tokenOut, abi: ERC20_DECIMALS_ABI, functionName: 'decimals', blockNumber }),
      reader.call({ account: tx.from as Hex, to: tx.router as Hex, data: tx.calldata as Hex, value: 0n, blockNumber }),
    ])
    const decimalsValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 36
    if (!decimalsValid(sourceDecimalsValue) || !decimalsValid(destinationDecimalsValue) || !simulation.data) return replayFailure('PINNED_SIMULATION_UNAVAILABLE', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
    const simulatedAmountOut = decodeInsightRiskSimulation(decoded.callProfile, simulation.data)
    const actualTradeAmountUsdMicros = (params.amountIn * sourcePrice * 1_000_000n) / (10n ** BigInt(sourceDecimalsValue) * 100_000_000n)
    const assessedTradeAmountUsdMicros = assessedAmount
    const oracleExpectedAmountOut = (params.amountIn * sourcePrice * 10n ** BigInt(destinationDecimalsValue)) /
      (destinationPrice * 10n ** BigInt(sourceDecimalsValue))
    if (simulatedAmountOut < 1n || actualTradeAmountUsdMicros < 1n || oracleExpectedAmountOut < 1n) return replayFailure('REPLAYED_VALUE_OUT_OF_RANGE', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
    const oracleDeviationBps = differenceBps(simulatedAmountOut, oracleExpectedAmountOut)
    const tradeAmountDeviationBps = differenceBps(actualTradeAmountUsdMicros, assessedTradeAmountUsdMicros)
    const amountOutMinimum = BigInt(String(tx.amountOutMinimum))
    const allowedSlippageBps = simulatedAmountOut > amountOutMinimum
      ? Number(((simulatedAmountOut - amountOutMinimum) * 10_000n) / simulatedAmountOut)
      : 0
    const replayMatches = simulatedAmountOut === BigInt(String(evidence.simulatedAmountOut)) &&
      oracleExpectedAmountOut === BigInt(String(evidence.oracleExpectedAmountOut)) &&
      actualTradeAmountUsdMicros === BigInt(String(evidence.actualTradeAmountUsdMicros)) &&
      assessedTradeAmountUsdMicros === BigInt(String(evidence.assessedTradeAmountUsdMicros)) &&
      oracleDeviationBps === Number(evidence.oracleDeviationBps) &&
      tradeAmountDeviationBps === Number(evidence.tradeAmountDeviationBps) &&
      allowedSlippageBps === Number(evidence.allowedSlippageBps)
    if (!replayMatches) return replayFailure('SIMULATION_OR_ORACLE_MATH_MISMATCH', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
    return { valid: true, code: 'PINNED_SIMULATION_REPLAYED', chainId: tx.chainId, blockNumber: String(block.number), blockHash: block.hash }
  } catch {
    return replayFailure('CHAIN_REPLAY_UNAVAILABLE', tx.chainId, String(evidence.blockNumber), String(evidence.blockHash))
  }
}

/** Adapts a viem public client to the narrow, read-only replay interface. */
export function createInsightSwapRiskChainReader(client: Pick<PublicClient, 'getChainId' | 'getBlock' | 'getBytecode' | 'readContract' | 'call'>): InsightSwapRiskChainReader {
  return {
    getChainId: () => client.getChainId(),
    getBlock: async ({ blockNumber }) => {
      const block = await client.getBlock({ blockNumber })
      return { number: block.number, timestamp: block.timestamp, hash: block.hash }
    },
    getBytecode: ({ address, blockNumber }) => client.getBytecode({ address, blockNumber }),
    readContract: ({ address, abi, functionName, blockNumber }) => client.readContract({ address, abi, functionName, blockNumber }),
    call: ({ account, to, data, value, blockNumber }) => client.call({ account, to, data, value, blockNumber }),
  }
}

/** Adds an independent, read-only RPC replay after the complete local signature,
 * trust, scope and authorization review has passed. The supplied reader should
 * use an RPC independent from the one that produced the advisory report.
 */
export async function verifyReviewManifestWithChain(
  manifest: ReviewManifest,
  options: LocalVerifierOptions & { insightKeyRegistry?: InsightKeyRegistry; insightProtocolTrust?: InsightProtocolTrust; insightDecisionInputPolicy?: InsightDecisionInputPolicy; insightSwapRiskPolicy?: InsightSwapRiskPolicy },
  reader: InsightSwapRiskChainReader,
): Promise<ReviewManifestChainResult> {
  const localReview = await verifyReviewManifestLocally(manifest, options)
  if (!localReview.valid) return { valid: false, code: 'LOCAL_REVIEW_FAILED', verificationOrigin: 'local+chain', localReview, insightSwapRiskReplay: null }
  const risk = manifest.attachments.find(attachment => attachment.role === transactionRiskRole)
  if (!risk) return { valid: true, code: 'OK_NO_SWAP_RISK_REPORT', verificationOrigin: 'local+chain', localReview, insightSwapRiskReplay: null }
  const source = manifest.attachments.find(attachment => attachment.role === 'insight.source')
  const destination = manifest.attachments.find(attachment => attachment.role === 'insight.destination')
  if (!source || !destination) {
    const replay = replayFailure('MISSING_PRETRADE_EVIDENCE')
    return { valid: false, code: replay.code, verificationOrigin: 'local+chain', localReview, insightSwapRiskReplay: replay }
  }
  let replay: InsightSwapRiskChainReplay
  try {
    replay = await replayInsightSwapRiskOnChain(JSON.parse(risk.rawJson), JSON.parse(source.rawJson), JSON.parse(destination.rawJson), reader)
  } catch {
    replay = replayFailure('INVALID_REVIEW_ATTACHMENT')
  }
  return { valid: replay.valid, code: replay.valid ? 'OK' : replay.code, verificationOrigin: 'local+chain', localReview, insightSwapRiskReplay: replay }
}
