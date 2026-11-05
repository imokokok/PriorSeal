import assert from 'node:assert/strict'
import test from 'node:test'

import { hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  BASE_AGENT_SWAP_GUARD_CHAIN_IDS,
  baseAgentSwapGuardIntentAsset,
  buildBaseAgentSwapGuardBoundIntents,
  detectInsightBaseAgentSwapGuardSettlementContradictions,
  verifyBaseAgentSwapGuardAuthorizationBundle,
  verifyBaseAgentSwapGuardSettlementForDecision,
  verifyInsightBaseAgentSwapGuardDecision,
  verifyInsightBaseAgentSwapGuardSettlement,
  type ExactCallIntentInput,
} from '../../sdk/dist/index.js'

// BNB (56) and Monad (143) swap authorization closure, mirroring the Base
// fixture. All addresses below are opaque test fixtures, not reviewed
// contracts; the reviewed pool/pair binding lives in Insight's guard specs.

const signer = privateKeyToAccount(`0x${'11'.repeat(32)}` as `0x${string}`)
const now = 1_792_252_800
const account = '0x1111111111111111111111111111111111111111' as const
const approvalData = '0x095ea7b3' as const
const swapData = '0x414bf389' as const
const domain = { name: 'Insight Base Agent Swap Guard', version: '1', chainId: 1 } as const
const settlementDomain = { name: 'Insight Base Agent Swap Guard Settlement', version: '1', chainId: 1 } as const
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

const FIXTURES: Record<number, { profileId: string; token: `0x${string}`; router: `0x${string}` }> = {
  8453: {
    profileId: 'base-aerodrome-slipstream-weth-usdc-cl100',
    token: `0x${'42'.repeat(20)}` as `0x${string}`,
    router: `0x${'43'.repeat(20)}` as `0x${string}`,
  },
  56: {
    profileId: 'bnb-pancakeswap-v3-usdt-usdc-100',
    token: `0x${'56'.repeat(20)}` as `0x${string}`,
    router: `0x${'65'.repeat(20)}` as `0x${string}`,
  },
  143: {
    profileId: 'monad-pancakeswap-v3-wmon-usdc-500',
    token: `0x${'aa'.repeat(20)}` as `0x${string}`,
    router: `0x${'bb'.repeat(20)}` as `0x${string}`,
  },
}

async function decision(chainId: number, overrides: { scopeProfileId?: string; scopeChainId?: number } = {}) {
  const fixture = FIXTURES[chainId] ?? FIXTURES[8453]
  const guard = {
    schema: 'insight.base-agent-swap-guard.v1' as const,
    verdict: 'ALLOW' as const,
    validUntil: now + 60,
    scope: {
      chainId: (overrides.scopeChainId ?? chainId) as number,
      profileId: overrides.scopeProfileId ?? fixture.profileId,
      transactionAuthority: 'none',
    },
    market: { exactInput: { amountInRaw: '1000000000000000000' } },
    binding: {
      chainId: chainId as number,
      recipient: account,
      approval: { token: fixture.token, spender: fixture.router, amountRaw: '1000000000000000000', calldataHash: keccak256(approvalData) },
      swap: { to: fixture.router, value: '0x0' as const, calldataHash: keccak256(swapData) },
    },
    transactionsToSign: {
      approval: { to: fixture.token, value: '0x0' as const, data: approvalData },
      swap: { to: fixture.router, value: '0x0' as const, data: swapData },
    },
  }
  const decisionHash = keccak256(toBytes(canonical(guard)))
  const completeGuard = { ...guard, decisionHash }
  const data = {
    decisionHash,
    approvalCalldataHash: keccak256(approvalData),
    swapCalldataHash: keccak256(swapData),
    recipient: account,
    chainId: chainId as number,
    verdict: 0 as const,
    issuedAt: now,
    validUntil: now + 60,
    schemaVersion: 1 as const,
  }
  const typedData = {
    domain,
    types,
    primaryType: 'BaseAgentSwapGuardDecision' as const,
    message: { ...data, chainId: BigInt(chainId), issuedAt: BigInt(now), validUntil: BigInt(now + 60), schemaVersion: 1n },
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

async function settlement(chainId: number, decisionHash: `0x${string}`, swapTxHash: `0x${string}`, reasonCodes: string[] = ['APPROVAL_TX_NOT_PRESENTED']) {
  const fixture = FIXTURES[chainId]
  const data = {
    decisionHash,
    swapTxHash,
    approvalTxHash: `0x${'0'.repeat(64)}` as const,
    onChainSwapCalldataHash: keccak256(swapData),
    recipient: account,
    chainId: chainId as number,
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
    message: { ...data, chainId: BigInt(chainId), executedAt: BigInt(data.executedAt), checkedAt: BigInt(data.checkedAt), schemaVersion: 1n },
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

function inputs(chainId: number) {
  const fixture = FIXTURES[chainId]
  const asset = baseAgentSwapGuardIntentAsset(fixture.token, chainId as never)
  const approval: ExactCallIntentInput = {
    transaction: { chainId, from: account, to: fixture.token, data: approvalData, nonce: '7', value: '0' },
    intentId: `swap-${chainId}-approval`, asset, amount: '1000000000000000000', validUntil: now + 100,
  }
  const swap: ExactCallIntentInput = {
    transaction: { chainId, from: account, to: fixture.router, data: swapData, nonce: '8', value: '0' },
    intentId: `swap-${chainId}-exact-input`, asset, amount: '1000000000000000000', validUntil: now + 100,
  }
  return { approval, swap }
}

for (const chainId of [56, 143]) {
  test(`closes the chain-${chainId} swap authorization loop with two exact ordered intents`, async () => {
    assert.equal(FIXTURES[chainId] !== undefined, true)
    const proof = await decision(chainId)
    assert.equal((await verifyInsightBaseAgentSwapGuardDecision(proof, options)).valid, true)
    const intents = await buildBaseAgentSwapGuardBoundIntents(inputs(chainId), proof, options)
    assert.equal(intents.approval.chainId, chainId)
    assert.equal(intents.swap.chainId, chainId)
    assert.equal(intents.approval.asset, `eip155:${chainId}/erc20:${FIXTURES[chainId].token.toLowerCase()}`)
    assert.deepEqual(await verifyBaseAgentSwapGuardAuthorizationBundle({
      approval: { intent: intents.approval, issuedAt: now + 1, expiresAt: now + 60 },
      swap: { intent: intents.swap, issuedAt: now + 1, expiresAt: now + 60 },
      decision: proof,
    }, options), { valid: true, reason: 'OK' })
  })

  test(`chain-${chainId} settlement verifies and cross-binds to its decision`, async () => {
    const proof = await decision(chainId)
    const closure = await settlement(chainId, proof.decisionHash, `0x${'cd'.repeat(32)}` as `0x${string}`)
    const verification = await verifyInsightBaseAgentSwapGuardSettlement(closure, options)
    assert.equal(verification.valid, true)
    assert.equal(verification.reason, 'OK')
    const cross = await verifyBaseAgentSwapGuardSettlementForDecision({ settlement: closure, decision: proof }, options)
    assert.equal(cross.valid, true)
    assert.equal(cross.reason, 'OK')
  })
}

test('rejects a decision on an unreviewed chain (chainId 1)', async () => {
  const verification = await verifyInsightBaseAgentSwapGuardDecision(await decision(1), options)
  assert.equal(verification.valid, false)
  assert.equal(verification.reason, 'CALL_BINDING_MISMATCH')
})

test('rejects a profile whose pinned chain does not match its scope chain', async () => {
  // BNB profile declared on Base scope: binding/scope disagree with the profile map.
  const verification = await verifyInsightBaseAgentSwapGuardDecision(await decision(8453, { scopeProfileId: 'bnb-pancakeswap-v3-usdt-usdc-100' }), options)
  assert.equal(verification.valid, false)
  assert.equal(verification.reason, 'CALL_BINDING_MISMATCH')
})

test('rejects settlement whose chain differs from the decision chain', async () => {
  const baseProof = await decision(8453)
  const bnbClosure = await settlement(56, baseProof.decisionHash, `0x${'ef'.repeat(32)}` as `0x${string}`)
  assert.equal((await verifyInsightBaseAgentSwapGuardSettlement(bnbClosure, options)).valid, true)
  const cross = await verifyBaseAgentSwapGuardSettlementForDecision({ settlement: bnbClosure, decision: baseProof }, options)
  assert.equal(cross.valid, false)
  assert.equal(cross.reason, 'CHAIN_MISMATCH')
})

test('legacy single-argument intent asset keeps the Base prefix', () => {
  const asset = baseAgentSwapGuardIntentAsset(`0x${'42'.repeat(20)}` as `0x${string}`)
  assert.equal(asset.startsWith('eip155:8453/erc20:'), true)
})

test('supported chain id list covers the three reviewed EVM chains', () => {
  assert.deepEqual([...BASE_AGENT_SWAP_GUARD_CHAIN_IDS].sort((a, b) => a - b), [56, 143, 8453])
})

test('contradiction detection spans chains: one decisionHash, two closures on different chains', async () => {
  const proof = await decision(56)
  const first = await settlement(56, proof.decisionHash, `0x${'01'.repeat(32)}` as `0x${string}`)
  const second = await settlement(143, proof.decisionHash, `0x${'02'.repeat(32)}` as `0x${string}`)
  const report = await detectInsightBaseAgentSwapGuardSettlementContradictions([first, second], options)
  assert.equal(report.consistent, false)
  assert.equal(report.contradictions.length, 1)
  assert.equal(report.contradictions[0].decisionHash, proof.decisionHash.toLowerCase())
  assert.deepEqual(report.contradictions[0].swapTxHashes, [`0x${'01'.repeat(32)}`, `0x${'02'.repeat(32)}`])
})
