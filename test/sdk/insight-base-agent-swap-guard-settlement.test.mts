import assert from 'node:assert/strict'
import test from 'node:test'

import { hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  detectInsightBaseAgentSwapGuardSettlementContradictions,
  verifyBaseAgentSwapGuardSettlementForDecision,
  verifyInsightBaseAgentSwapGuardDecision,
  verifyInsightBaseAgentSwapGuardSettlement,
} from '../../sdk/dist/index.js'

const signer = privateKeyToAccount(`0x${'11'.repeat(32)}` as `0x${string}`)
const now = 1_792_252_800
const account = '0x1111111111111111111111111111111111111111' as const
const token = '0x4200000000000000000000000000000000000006' as const
const router = '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5' as const
const approvalData = '0x095ea7b3' as const
const swapData = '0x414bf389' as const
const domain = { name: 'Insight Base Agent Swap Guard', version: '1', chainId: 1 } as const
const types = {
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
const settlementDomain = { name: 'Insight Base Agent Swap Guard Settlement', version: '1', chainId: 1 } as const
const settlementTypes = {
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
const keyRegistry = {
  keys: [{ key_id: 'insight-test', public_key: signer.address, validFrom: new Date(0).toISOString(), validUntil: null, revoked: false, role: 'attester' as const }],
}
const options = { keyRegistry, now }

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
}

async function decision() {
  const guard = {
    schema: 'insight.base-agent-swap-guard.v1' as const,
    verdict: 'ALLOW' as const,
    validUntil: now + 60,
    scope: { chainId: 8453 as const, profileId: 'base-aerodrome-slipstream-weth-usdc-cl100', transactionAuthority: 'none' },
    market: { exactInput: { amountInRaw: '1000000000000000000' } },
    binding: {
      chainId: 8453 as const,
      recipient: account,
      approval: { token, spender: router, amountRaw: '1000000000000000000', calldataHash: keccak256(approvalData) },
      swap: { to: router, value: '0x0' as const, calldataHash: keccak256(swapData) },
    },
    transactionsToSign: {
      approval: { to: token, value: '0x0' as const, data: approvalData },
      swap: { to: router, value: '0x0' as const, data: swapData },
    },
  }
  const decisionHash = keccak256(toBytes(canonical(guard)))
  const completeGuard = { ...guard, decisionHash }
  const data = {
    decisionHash,
    approvalCalldataHash: keccak256(approvalData),
    swapCalldataHash: keccak256(swapData),
    recipient: account,
    chainId: 8453 as const,
    verdict: 0 as const,
    issuedAt: now,
    validUntil: now + 60,
    schemaVersion: 1 as const,
  }
  const typedData = {
    domain,
    types,
    primaryType: 'BaseAgentSwapGuardDecision' as const,
    message: { ...data, chainId: 8453n, issuedAt: BigInt(now), validUntil: BigInt(now + 60), schemaVersion: 1n },
  }
  return {
    schema: 'insight.base-agent-swap-guard-decision.v1' as const,
    guard: completeGuard,
    decisionHash,
    attestation: {
      type: 'BaseAgentSwapGuardDecision' as const,
      schemaVersion: 1 as const,
      uid: hashTypedData(typedData),
      attester: signer.address,
      attesterLabel: 'Insight Base Agent Swap Guard attester' as const,
      signedAt: new Date(now * 1000).toISOString(),
      validForSeconds: 60,
      signature: await signer.signTypedData(typedData),
      verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/base-agent-swap-guard/verify',
      data,
      eip712: { domain, types, primaryType: 'BaseAgentSwapGuardDecision' },
    },
  }
}

async function settlement(decisionHash: `0x${string}`, swapTxHash: `0x${string}`, reasonCodes: string[] = ['APPROVAL_TX_NOT_PRESENTED']) {
  const data = {
    decisionHash,
    swapTxHash,
    approvalTxHash: `0x${'0'.repeat(64)}` as const,
    onChainSwapCalldataHash: keccak256(swapData),
    recipient: account,
    chainId: 8453 as const,
    fillStatus: 'FULL' as const,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '3200000000',
    executedPrice: '3200',
    realizedSlippageBps: '12.5',
    blockNumber: '27134567',
    executedAt: now + 12,
    checkedAt: now + 40,
    reasonCodesHash: keccak256(toBytes(canonical(reasonCodes))),
    schemaVersion: 1 as const,
  }
  const typedData = {
    domain: settlementDomain,
    types: settlementTypes,
    primaryType: 'BaseAgentSwapGuardSettlement' as const,
    message: { ...data, chainId: 8453n, executedAt: BigInt(data.executedAt), checkedAt: BigInt(data.checkedAt), schemaVersion: 1n },
  }
  return {
    type: 'BaseAgentSwapGuardSettlement' as const,
    schemaVersion: 1 as const,
    schema: 'insight.base-agent-swap-guard-settlement.v1' as const,
    uid: hashTypedData(typedData),
    attester: signer.address,
    attesterLabel: 'Insight Base Agent Swap Guard settlement attester' as const,
    signedAt: new Date((now + 40) * 1000).toISOString(),
    signature: await signer.signTypedData(typedData),
    verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/base-agent-swap-guard/settlement',
    decisionHash,
    reasonCodes,
    data,
    eip712: { domain: settlementDomain, types: settlementTypes, primaryType: 'BaseAgentSwapGuardSettlement' },
  }
}

test('closes the swap loop: settlement verifies and cross-binds to its decision', async () => {
  const proof = await decision()
  assert.equal((await verifyInsightBaseAgentSwapGuardDecision(proof, options)).valid, true)
  const closure = await settlement(proof.decisionHash, `0x${'ab'.repeat(32)}` as `0x${string}`)
  const verification = await verifyInsightBaseAgentSwapGuardSettlement(closure, options)
  assert.equal(verification.valid, true)
  assert.equal(verification.reason, 'OK')
  const cross = await verifyBaseAgentSwapGuardSettlementForDecision({ settlement: closure, decision: proof }, options)
  assert.deepEqual(cross, { valid: true, reason: 'OK', decisionHash: proof.decisionHash.toLowerCase(), swapTxHash: `0x${'ab'.repeat(32)}`, attester: signer.address.toLowerCase() })
})

test('rejects a settlement whose reason codes were tampered after signing', async () => {
  const proof = await decision()
  const closure = await settlement(proof.decisionHash, `0x${'ab'.repeat(32)}` as `0x${string}`)
  const tampered = { ...closure, reasonCodes: ['APPROVAL_TX_NOT_PRESENTED', 'REALIZED_SLIPPAGE_EXCEEDED'] }
  const verification = await verifyInsightBaseAgentSwapGuardSettlement(tampered, options)
  assert.equal(verification.valid, false)
  assert.equal(verification.reason, 'REASON_CODES_MISMATCH')
})

test('rejects a settlement bound to different executed calldata than the decision guarded', async () => {
  const proof = await decision()
  const closure = await settlement(proof.decisionHash, `0x${'ab'.repeat(32)}` as `0x${string}`)
  const tampered = structuredClone(closure)
  tampered.data.onChainSwapCalldataHash = keccak256('0xdeadbeef')
  const cross = await verifyBaseAgentSwapGuardSettlementForDecision({ settlement: tampered, decision: proof }, options)
  assert.equal(cross.valid, false)
  assert.equal(cross.reason.startsWith('SETTLEMENT_') || cross.reason === 'CALLDATA_HASH_MISMATCH', true)
})

test('rejects a settlement cross-binding whose decision fails its own verification', async () => {
  const proof = await decision()
  const closure = await settlement(proof.decisionHash, `0x${'ab'.repeat(32)}` as `0x${string}`)
  // No key registry: the decision's attester is untrusted, so the closure is
  // refused before the settlement is even examined.
  const cross = await verifyBaseAgentSwapGuardSettlementForDecision({ settlement: closure, decision: proof }, {})
  assert.equal(cross.valid, false)
  assert.equal(cross.reason, 'DECISION_SIGNER_UNTRUSTED')
  assert.equal(cross.swapTxHash, null)
})

test('flags two closures of one decision claiming different swap transactions', async () => {
  const proof = await decision()
  const first = await settlement(proof.decisionHash, `0x${'ab'.repeat(32)}` as `0x${string}`)
  const second = await settlement(proof.decisionHash, `0x${'cd'.repeat(32)}` as `0x${string}`, ['APPROVAL_TX_NOT_PRESENTED', 'DECISION_EXPIRED_AT_CLOSURE'])
  const replay = await settlement(proof.decisionHash, `0x${'ab'.repeat(32)}` as `0x${string}`)
  const report = await detectInsightBaseAgentSwapGuardSettlementContradictions([first, second, replay, { type: 'BaseAgentSwapGuardSettlement' }], options)
  assert.equal(report.verified, 3)
  assert.equal(report.unverified.length, 1)
  assert.equal(report.consistent, false)
  assert.equal(report.contradictions.length, 1)
  assert.equal(report.contradictions[0].decisionHash, proof.decisionHash.toLowerCase())
  assert.deepEqual(report.contradictions[0].swapTxHashes.sort(), [`0x${'ab'.repeat(32)}`, `0x${'cd'.repeat(32)}`])
})

test('a consistent settlement set reports no contradictions', async () => {
  const proof = await decision()
  const closure = await settlement(proof.decisionHash, `0x${'ab'.repeat(32)}` as `0x${string}`)
  const replay = await settlement(proof.decisionHash, `0x${'ab'.repeat(32)}` as `0x${string}`)
  const report = await detectInsightBaseAgentSwapGuardSettlementContradictions([closure, replay], options)
  assert.equal(report.consistent, true)
  assert.equal(report.contradictions.length, 0)
})
