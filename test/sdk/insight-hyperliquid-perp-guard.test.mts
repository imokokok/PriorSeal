import assert from 'node:assert/strict'
import test from 'node:test'

import { hashTypedData, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  buildHyperliquidPerpGuardBoundIntent,
  buildHyperliquidPerpGuardSubmission,
  verifyHyperliquidPerpGuardAuthorizationBinding,
  verifyInsightHyperliquidPerpGuardDecision,
  type InsightHyperliquidPerpGuardDecision,
} from '../../sdk/dist/index.js'

const signer = privateKeyToAccount(`0x${'22'.repeat(32)}` as `0x${string}`)
const now = 1_792_252_800
const account = '0x1111111111111111111111111111111111111111' as const
const expiresAfter = now * 1000 + 60_000
const nonce = now * 1000 + 30_000
const envelope = {
  action: {
    type: 'order' as const,
    orders: [{ a: 0, b: true, p: '1100.5', s: '0.5', r: false as const, t: { limit: { tif: 'Ioc' as const } }, c: `0x${'33'.repeat(16)}` }],
    grouping: 'na' as const,
  },
  expiresAfter,
}
const domain = { name: 'Insight Hyperliquid Perp Guard', version: '1', chainId: 1 } as const
const types = {
  HyperliquidPerpGuardDecision: [
    { name: 'decisionHash', type: 'bytes32' },
    { name: 'intentHash', type: 'bytes32' },
    { name: 'coin', type: 'string' },
    { name: 'assetIndex', type: 'uint256' },
    { name: 'size', type: 'string' },
    { name: 'isBuy', type: 'bool' },
    { name: 'builderFeeTenths', type: 'uint256' },
    { name: 'verdict', type: 'uint8' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'validUntil', type: 'uint256' },
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

async function decision(): Promise<InsightHyperliquidPerpGuardDecision> {
  const order = structuredClone(envelope)
  const guard = {
    schema: 'insight.hyperliquid-perp-guard.v1' as const,
    verdict: 'ALLOW' as const,
    protocolId: 'hyperliquid-perps-mainnet' as const,
    action: 'open_long' as const,
    evaluatedAt: new Date(now * 1000).toISOString(),
    scope: { venue: 'hyperliquid', network: 'mainnet', transactionAuthority: 'none', valuation: 'caller_declared_post_action_usd' },
    market: { assetSymbol: 'BTC', marginAssetSymbol: 'USDC', maxLeverage: 40, maxLeverageSource: 'reviewed-profile', parameterSource: 'reviewed-profile' },
    projected: { sizeUsd: 550.25 },
  }
  const binding = {
    intentHash: keccak256(new TextEncoder().encode(canonical(order))),
    coin: 'BTC',
    assetIndex: 0,
    isBuy: true,
    size: '0.5',
    limitPrice: '1100.5',
    reduceOnly: false as const,
    expiresAfter,
    impliedSizeUsd: 0.5 * 1100.5,
    builder: null,
  }
  const decisionHash = keccak256(new TextEncoder().encode(canonical({ schema: 'insight.hyperliquid-perp-guard-decision.v1', guard, order, binding })))
  const data = {
    decisionHash,
    intentHash: binding.intentHash,
    coin: 'BTC',
    assetIndex: 0,
    size: '0.5',
    isBuy: true,
    builderFeeTenths: 0,
    verdict: 0 as const,
    issuedAt: now,
    validUntil: now + 300,
    schemaVersion: 1 as const,
  }
  const typedData = {
    domain,
    types,
    primaryType: 'HyperliquidPerpGuardDecision' as const,
    message: { ...data, assetIndex: 0n, builderFeeTenths: 0n, issuedAt: BigInt(now), validUntil: BigInt(now + 300), schemaVersion: 1n },
  }
  return {
    schema: 'insight.hyperliquid-perp-guard-decision.v1' as const,
    guard,
    order,
    binding,
    decisionHash,
    attestation: {
      type: 'HyperliquidPerpGuardDecision' as const,
      schemaVersion: 1 as const,
      uid: hashTypedData(typedData),
      attester: signer.address,
      attesterLabel: 'Insight Hyperliquid Perp Guard attester' as const,
      signedAt: new Date(now * 1000).toISOString(),
      validForSeconds: 300,
      signature: await signer.signTypedData(typedData),
      verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/hyperliquid-perp-guard/verify',
      data,
      eip712: { domain, types, primaryType: 'HyperliquidPerpGuardDecision' },
    },
  }
}

test('verifies the signed perp assessment and binds one exact IOC envelope', async () => {
  const proof = await decision()
  assert.equal((await verifyInsightHyperliquidPerpGuardDecision(proof, options)).valid, true)
  const intent = await buildHyperliquidPerpGuardBoundIntent({
    intentId: 'hyperliquid-perp-test',
    account,
    amount: '550250000',
    nonce,
    validUntil: now + 500,
  }, proof, options)
  assert.equal(intent.executionProfile, 'priorseal.execution-profile.hyperliquid-perp-ioc.v1')
  assert.equal(intent.asset, 'hyperliquid:mainnet/perp:0')
  assert.equal(intent.validUntil, now + 60)
  assert.deepEqual(intent.contextCommitments, [{ namespace: 'insight.hyperliquid-perp-guard.v1', algorithm: 'keccak256', digest: proof.decisionHash }])
  assert.deepEqual(await verifyHyperliquidPerpGuardAuthorizationBinding({ intent, issuedAt: now + 1, expiresAt: now + 60 }, proof, options), { valid: true, reason: 'OK' })
})

test('serializes the authorization into the exact unsigned exchange action', async () => {
  const proof = await decision()
  const intent = await buildHyperliquidPerpGuardBoundIntent({ intentId: 'hyperliquid-perp-test', account, amount: '1', nonce, validUntil: now + 500 }, proof, options)
  const submission = buildHyperliquidPerpGuardSubmission(intent)
  assert.equal(submission.schema, 'priorseal.hyperliquid-perp-ioc-submission.v1')
  assert.deepEqual(submission.action.orders, envelope.action.orders)
  assert.equal(submission.expiresAfter, expiresAfter)
  assert.equal('signature' in submission, false)
})

test('rejects a substituted order field before authorization', async () => {
  const proof = await decision()
  proof.order.action.orders[0].s = '0.6'
  await assert.rejects(buildHyperliquidPerpGuardBoundIntent({ intentId: 'hyperliquid-perp-test', account, amount: '1', nonce, validUntil: now + 500 }, proof, options))
})

test('fails closed on builder-fee envelopes instead of authorizing beyond the assessment', async () => {
  const proof = await decision()
  const attestation = proof.attestation!
  proof.order.action.builder = { b: '0x9999999999999999999999999999999999999999', f: 50 }
  proof.binding.builder = { b: '0x9999999999999999999999999999999999999999', f: 50 }
  proof.binding.intentHash = keccak256(new TextEncoder().encode(canonical(proof.order)))
  proof.decisionHash = keccak256(new TextEncoder().encode(canonical({ schema: 'insight.hyperliquid-perp-guard-decision.v1', guard: proof.guard, order: proof.order, binding: proof.binding })))
  attestation.data.decisionHash = proof.decisionHash
  attestation.data.builderFeeTenths = 50
  attestation.data.intentHash = proof.binding.intentHash
  const typedData = {
    domain,
    types,
    primaryType: 'HyperliquidPerpGuardDecision' as const,
    message: { ...attestation.data, assetIndex: 0n, builderFeeTenths: 50n, issuedAt: BigInt(now), validUntil: BigInt(now + 300), schemaVersion: 1n },
  }
  attestation.uid = hashTypedData(typedData)
  attestation.signature = await signer.signTypedData(typedData)
  await assert.rejects(
    buildHyperliquidPerpGuardBoundIntent({ intentId: 'hyperliquid-perp-test', account, amount: '1', nonce, validUntil: now + 500 }, proof, options),
    /HYPERLIQUID_PERP_GUARD_BUILDER_FEE_NOT_SUPPORTED/,
  )
})
