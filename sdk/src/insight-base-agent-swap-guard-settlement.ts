/**
 * Post-settlement closure consumption for Insight's Base Agent Swap Guard.
 *
 * Insight's guard decision authorizes two exact calls (approval + swap). After
 * execution Insight signs a `BaseAgentSwapGuardSettlement` binding the
 * `decisionHash` to the executed transaction hashes and the reconciled fill.
 * This module closes PriorSeal's side of that loop offline:
 *
 *   1. Independently verify the signed settlement (structural shape, reason
 *      code hash, typed-data uid, attester signature, key-registry trust).
 *   2. Cross-bind the settlement to its guard decision: one decisionHash, one
 *      reviewed chain, one recipient, and the on-chain swap calldata hash must
 *      equal the calldata hash the decision guarded.
 *   3. Detect contradictions across a set of settlements: two verified
 *      closures claiming the same decisionHash for different swap transactions
 *      is something no honest settlement can produce.
 *
 * Honesty boundaries: the settlement certifies "the executed bytes were the
 * guarded bytes and the fill matched the guarded quote" as reported by
 * Insight's RPC reconciliation. This module re-verifies the signature and the
 * binding arithmetic locally; it does not re-read the chain, so it inherits
 * Insight's reconciliation claims rather than re-deriving them.
 */

import { hashTypedData, keccak256, toBytes, verifyTypedData } from 'viem'

import type { InsightBaseAgentSwapGuardDecision } from './insight-base-agent-swap-guard.js'
import { insightKeyRegistryTrust, verifyInsightBaseAgentSwapGuardDecision } from './insight-base-agent-swap-guard.js'

export const INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_SCHEMA = 'insight.base-agent-swap-guard-settlement.v1' as const
export const INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_PRIMARY_TYPE = 'BaseAgentSwapGuardSettlement' as const
export const INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_ATTESTER_LABEL = 'Insight Base Agent Swap Guard settlement attester' as const

const DOMAIN = { name: 'Insight Base Agent Swap Guard Settlement', version: '1', chainId: 1 } as const
const TYPES = {
  BaseAgentSwapGuardSettlement: [
    { name: 'decisionHash', type: 'bytes32' },
    { name: 'swapTxHash', type: 'bytes32' },
    { name: 'approvalTxHash', type: 'bytes32' },
    { name: 'onChainSwapCalldataHash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'fillStatus', type: 'string' },
    { name: 'sourceAmountRaw', type: 'string' },
    { name: 'destinationAmountRaw', type: 'string' },
    { name: 'executedPrice', type: 'string' },
    { name: 'realizedSlippageBps', type: 'string' },
    { name: 'blockNumber', type: 'string' },
    { name: 'executedAt', type: 'uint256' },
    { name: 'checkedAt', type: 'uint256' },
    { name: 'reasonCodesHash', type: 'bytes32' },
    { name: 'schemaVersion', type: 'uint256' },
  ],
} as const
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/
const UINT = /^(?:0|[1-9][0-9]*)$/
/** Raw amounts are exact decimal strings; '' means Insight could not attribute them. */
const RAW_AMOUNT = /^(?:0|[1-9][0-9]*)?$/
/** Human prices and slippage are decimal strings; '' means unavailable; slippage may be negative. */
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const SIGNED_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
export const SETTLEMENT_CHAIN_IDS = new Set<number>([8453, 56])

export type InsightBaseAgentSwapGuardSettlementData = {
  decisionHash: `0x${string}`
  swapTxHash: `0x${string}`
  /** Zero hash when the caller did not present an approval transaction. */
  approvalTxHash: `0x${string}`
  /** keccak256 of the settlement transaction's actual input bytes. */
  onChainSwapCalldataHash: `0x${string}`
  recipient: string
  chainId: 8453 | 56
  fillStatus: 'FULL' | 'REVERTED'
  sourceAmountRaw: string
  destinationAmountRaw: string
  executedPrice: string
  realizedSlippageBps: string
  blockNumber: string
  executedAt: number
  checkedAt: number
  reasonCodesHash: `0x${string}`
  schemaVersion: 1
}

export type InsightBaseAgentSwapGuardSettlement = {
  type: typeof INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_PRIMARY_TYPE
  schemaVersion: 1
  schema: typeof INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_SCHEMA
  uid: `0x${string}` | null
  attester: string | null
  attesterLabel: typeof INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_ATTESTER_LABEL
  signedAt: string
  signature: `0x${string}` | null
  verifyUrl: string
  decisionHash: `0x${string}`
  reasonCodes: string[]
  data: InsightBaseAgentSwapGuardSettlementData
  eip712: Record<string, unknown>
}

export type InsightBaseAgentSwapGuardSettlementVerification = {
  valid: boolean
  decisionHash: string | null
  swapTxHash: string | null
  attester: string | null
  reason: string
}

export type InsightBaseAgentSwapGuardSettlementOptions = {
  keyRegistry?: Parameters<typeof insightKeyRegistryTrust>[0]
  now?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

/** Mirrors Insight canonical JSON so integrity hashes are independently reproducible. */
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('Settlement exceeds canonical JSON depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new TypeError('Settlement is too large')
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    if (keys.length > 20_000 || keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key)))
      throw new TypeError('Unsafe settlement JSON')
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`
  }
  throw new TypeError('Settlement is not canonical JSON')
}

function sameHash(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && HEX32.test(left) && HEX32.test(right) && left.toLowerCase() === right.toLowerCase()
}

function typedData(data: InsightBaseAgentSwapGuardSettlementData) {
  return {
    domain: DOMAIN,
    types: TYPES,
    primaryType: INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_PRIMARY_TYPE,
    message: {
      decisionHash: data.decisionHash,
      swapTxHash: data.swapTxHash,
      approvalTxHash: data.approvalTxHash,
      onChainSwapCalldataHash: data.onChainSwapCalldataHash,
      recipient: data.recipient as `0x${string}`,
      chainId: BigInt(data.chainId),
      fillStatus: data.fillStatus,
      sourceAmountRaw: data.sourceAmountRaw,
      destinationAmountRaw: data.destinationAmountRaw,
      executedPrice: data.executedPrice,
      realizedSlippageBps: data.realizedSlippageBps,
      blockNumber: data.blockNumber,
      executedAt: BigInt(data.executedAt),
      checkedAt: BigInt(data.checkedAt),
      reasonCodesHash: data.reasonCodesHash,
      schemaVersion: 1n,
    },
  } as const
}

function settlementEnvelope(value: unknown): InsightBaseAgentSwapGuardSettlement | null {
  if (!isRecord(value) || value.type !== INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_PRIMARY_TYPE ||
    value.schema !== INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_SCHEMA || value.schemaVersion !== 1 ||
    value.attesterLabel !== INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_ATTESTER_LABEL || !isRecord(value.data) ||
    !Array.isArray(value.reasonCodes) || (value.reasonCodes as unknown[]).some((code) => typeof code !== 'string')) return null
  return value as unknown as InsightBaseAgentSwapGuardSettlement
}

function dataShape(data: InsightBaseAgentSwapGuardSettlementData): boolean {
  return (
    HEX32.test(data.decisionHash) && HEX32.test(data.swapTxHash) && HEX32.test(data.approvalTxHash) &&
    HEX32.test(data.onChainSwapCalldataHash) && HEX32.test(data.reasonCodesHash) &&
    ADDRESS.test(data.recipient) && SETTLEMENT_CHAIN_IDS.has(data.chainId) &&
    (data.fillStatus === 'FULL' || data.fillStatus === 'REVERTED') &&
    RAW_AMOUNT.test(data.sourceAmountRaw) && RAW_AMOUNT.test(data.destinationAmountRaw) &&
    (data.executedPrice === '' || DECIMAL.test(data.executedPrice)) &&
    (data.realizedSlippageBps === '' || SIGNED_DECIMAL.test(data.realizedSlippageBps)) &&
    UINT.test(data.blockNumber) && Number.isSafeInteger(data.executedAt) && data.executedAt >= 0 &&
    Number.isSafeInteger(data.checkedAt) && data.checkedAt > 0 && data.schemaVersion === 1
  )
}

/**
 * Independently verify a signed settlement closure: structure, reason-code
 * hash, typed-data uid, attester signature, and key-registry trust. The
 * decisionHash and swapTxHash are reported even when trust or signature fails,
 * so callers can run contradiction detection over untrusted input.
 */
export async function verifyInsightBaseAgentSwapGuardSettlement(value: unknown, options: InsightBaseAgentSwapGuardSettlementOptions = {}): Promise<InsightBaseAgentSwapGuardSettlementVerification> {
  const empty = { valid: false, decisionHash: null, swapTxHash: null, attester: null, reason: 'MALFORMED' } as const
  try {
    const settlement = settlementEnvelope(value)
    if (!settlement || typeof settlement.uid !== 'string' || !HEX32.test(settlement.uid) ||
      typeof settlement.attester !== 'string' || !ADDRESS.test(settlement.attester) ||
      typeof settlement.signature !== 'string' || !SIGNATURE.test(settlement.signature) ||
      typeof settlement.signedAt !== 'string' || typeof settlement.verifyUrl !== 'string' ||
      settlement.reasonCodes.length > 64 || settlement.reasonCodes.some((code) => code.length > 128)) {
      return { ...empty }
    }
    const data = settlement.data as InsightBaseAgentSwapGuardSettlementData
    if (!isRecord(data) || !dataShape(data)) return { ...empty }
    const bound = { decisionHash: data.decisionHash.toLowerCase(), swapTxHash: data.swapTxHash.toLowerCase(), attester: settlement.attester.toLowerCase() }
    if (settlement.signedAt !== new Date(data.checkedAt * 1000).toISOString()) return { ...empty, ...bound, reason: 'MALFORMED' }
    let expectedCodesHash: `0x${string}`
    try {
      expectedCodesHash = keccak256(toBytes(canonicalJson(settlement.reasonCodes)))
    } catch {
      return { ...empty, ...bound, reason: 'MALFORMED' }
    }
    if (!sameHash(expectedCodesHash, data.reasonCodesHash)) return { ...empty, ...bound, reason: 'REASON_CODES_MISMATCH' }
    if (canonicalJson(settlement.eip712) !== canonicalJson({ domain: DOMAIN, types: TYPES, primaryType: INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_PRIMARY_TYPE })) return { ...empty, ...bound, reason: 'MALFORMED' }
    const args = typedData(data)
    if (!sameHash(hashTypedData(args), settlement.uid)) return { ...empty, ...bound, reason: 'UID_MISMATCH' }
    const signatureValid = await verifyTypedData({ ...args, address: settlement.attester as `0x${string}`, signature: settlement.signature })
    if (!signatureValid) return { ...empty, ...bound, reason: 'SIGNATURE_INVALID' }
    const trusted = insightKeyRegistryTrust(options.keyRegistry, settlement.attester, data.checkedAt)
    if (!trusted) return { ...empty, ...bound, signatureValid: true, reason: 'SIGNER_UNTRUSTED' } as InsightBaseAgentSwapGuardSettlementVerification
    return { valid: true, ...bound, reason: 'OK' }
  } catch {
    return { ...empty, reason: 'VERIFICATION_ERROR' }
  }
}

export type InsightBaseAgentSwapGuardSettlementCrossCheck = {
  valid: boolean
  reason: string
  decisionHash: string | null
  swapTxHash: string | null
  attester: string | null
}

/**
 * Verify a settlement against the guard decision it claims to close: the
 * decision itself is verified first (signature, trust, binding arithmetic —
 * historically, since closure is a fact about the past, not a forward
 * authorization), then the decisionHash, reviewed chain, recipient and guarded
 * swap calldata hash must all agree.
 */
export async function verifyBaseAgentSwapGuardSettlementForDecision(input: { settlement: unknown; decision: unknown }, options: InsightBaseAgentSwapGuardSettlementOptions = {}): Promise<InsightBaseAgentSwapGuardSettlementCrossCheck> {
  const decisionVerification = await verifyInsightBaseAgentSwapGuardDecision(input.decision, { keyRegistry: options.keyRegistry, allowHistorical: true })
  if (!decisionVerification.valid || !decisionVerification.trusted) {
    return { valid: false, reason: `DECISION_${decisionVerification.reason}`, decisionHash: decisionVerification.decisionHash, swapTxHash: null, attester: decisionVerification.attester }
  }
  const settlementVerification = await verifyInsightBaseAgentSwapGuardSettlement(input.settlement, options)
  if (!settlementVerification.valid) return { ...settlementVerification, reason: `SETTLEMENT_${settlementVerification.reason}` }
  const settlement = input.settlement as InsightBaseAgentSwapGuardSettlement
  const decision = input.decision as InsightBaseAgentSwapGuardDecision
  const guard = decision.guard
  const binding = guard.binding as { swap: { calldataHash: string }; recipient: string }
  const scope = guard.scope as { chainId: number }
  if (!sameHash(settlement.data.decisionHash, decision.decisionHash)) return { valid: false, reason: 'DECISION_HASH_MISMATCH', decisionHash: settlementVerification.decisionHash, swapTxHash: settlementVerification.swapTxHash, attester: settlementVerification.attester }
  if (settlement.data.chainId !== scope.chainId) return { valid: false, reason: 'CHAIN_MISMATCH', decisionHash: settlementVerification.decisionHash, swapTxHash: settlementVerification.swapTxHash, attester: settlementVerification.attester }
  if (settlement.data.recipient.toLowerCase() !== String(binding.recipient).toLowerCase()) return { valid: false, reason: 'RECIPIENT_MISMATCH', decisionHash: settlementVerification.decisionHash, swapTxHash: settlementVerification.swapTxHash, attester: settlementVerification.attester }
  if (!sameHash(settlement.data.onChainSwapCalldataHash, binding.swap.calldataHash)) return { valid: false, reason: 'CALLDATA_HASH_MISMATCH', decisionHash: settlementVerification.decisionHash, swapTxHash: settlementVerification.swapTxHash, attester: settlementVerification.attester }
  return { valid: true, reason: 'OK', decisionHash: settlementVerification.decisionHash, swapTxHash: settlementVerification.swapTxHash, attester: settlementVerification.attester }
}

export type InsightBaseAgentSwapGuardSettlementContradiction = {
  decisionHash: string
  swapTxHashes: string[]
  attesters: string[]
  indices: number[]
}

export type InsightBaseAgentSwapGuardSettlementSetReport = {
  consistent: boolean
  verified: number
  unverified: Array<{ index: number; reason: string }>
  contradictions: InsightBaseAgentSwapGuardSettlementContradiction[]
}

/**
 * Detect double settlements across a set of (possibly untrusted) closures:
 * two verified settlements claiming the same decisionHash for different swap
 * transactions. Unverifiable entries are reported, never treated as
 * contradictions — the contradiction claim itself must verify first.
 */
export async function detectInsightBaseAgentSwapGuardSettlementContradictions(settlements: readonly unknown[], options: InsightBaseAgentSwapGuardSettlementOptions = {}): Promise<InsightBaseAgentSwapGuardSettlementSetReport> {
  const report: InsightBaseAgentSwapGuardSettlementSetReport = { consistent: true, verified: 0, unverified: [], contradictions: [] }
  const byDecision = new Map<string, { index: number; swapTxHash: string; attester: string }[]>()
  for (const [index, candidate] of settlements.entries()) {
    const verification = await verifyInsightBaseAgentSwapGuardSettlement(candidate, options)
    if (!verification.valid || verification.decisionHash === null || verification.swapTxHash === null) {
      report.unverified.push({ index, reason: verification.reason })
      continue
    }
    report.verified += 1
    const group = byDecision.get(verification.decisionHash) ?? []
    group.push({ index, swapTxHash: verification.swapTxHash, attester: verification.attester ?? '' })
    byDecision.set(verification.decisionHash, group)
  }
  for (const [decisionHash, group] of byDecision) {
    const distinctSwapTxHashes = [...new Set(group.map((entry) => entry.swapTxHash))]
    if (distinctSwapTxHashes.length > 1) {
      report.consistent = false
      report.contradictions.push({
        decisionHash,
        swapTxHashes: distinctSwapTxHashes,
        attesters: [...new Set(group.map((entry) => entry.attester))],
        indices: group.map((entry) => entry.index),
      })
    }
  }
  return report
}
