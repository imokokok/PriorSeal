import assert from 'node:assert/strict'
import test from 'node:test'

import { hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  baseAgentSwapGuardIntentAsset,
  buildBaseAgentSwapGuardBoundIntents,
  verifyBaseAgentSwapGuardAuthorizationBundle,
  verifyInsightBaseAgentSwapGuardDecision,
  type ExactCallIntentInput,
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
const keyRegistry = {
  keys: [{ key_id: 'insight-test', public_key: signer.address, validFrom: new Date(0).toISOString(), validUntil: null, revoked: false, role: 'attester' as const }],
}

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

function inputs() {
  const asset = baseAgentSwapGuardIntentAsset(token)
  const approval: ExactCallIntentInput = {
    transaction: { chainId: 8453, from: account, to: token, data: approvalData, nonce: '7', value: '0' },
    intentId: 'base-swap-approval', asset, amount: '1000000000000000000', validUntil: now + 100,
  }
  const swap: ExactCallIntentInput = {
    transaction: { chainId: 8453, from: account, to: router, data: swapData, nonce: '8', value: '0' },
    intentId: 'base-swap-exact-input', asset, amount: '1000000000000000000', validUntil: now + 100,
  }
  return { approval, swap }
}

test('closes the Base swap authorization loop with two exact ordered intents', async () => {
  const proof = await decision()
  assert.equal((await verifyInsightBaseAgentSwapGuardDecision(proof, { keyRegistry, now })).valid, true)
  const intents = await buildBaseAgentSwapGuardBoundIntents(inputs(), proof, { keyRegistry, now })
  assert.equal(intents.approval.validUntil, now + 60)
  assert.equal(intents.swap.validUntil, now + 60)
  assert.equal(intents.approval.callTarget, token.toLowerCase())
  assert.equal(intents.swap.callTarget, router.toLowerCase())
  assert.deepEqual(await verifyBaseAgentSwapGuardAuthorizationBundle({
    approval: { intent: intents.approval, issuedAt: now + 1, expiresAt: now + 60 },
    swap: { intent: intents.swap, issuedAt: now + 1, expiresAt: now + 60 },
    decision: proof,
  }, { keyRegistry, now }), { valid: true, reason: 'OK' })
})

for (const mutation of ['approval-target', 'non-consecutive-nonce', 'split-expiry'] as const) test(`rejects ${mutation} before authorization`, async () => {
  const input = inputs()
  if (mutation === 'approval-target') input.approval.transaction.to = router
  if (mutation === 'non-consecutive-nonce') input.swap.transaction.nonce = '9'
  if (mutation === 'split-expiry') input.swap.validUntil = now + 99
  await assert.rejects(buildBaseAgentSwapGuardBoundIntents(input, await decision(), { keyRegistry, now }))
})
