// Generates the deterministic fixtures for the Insight Base Agent Swap Guard
// reference agent: assess → bind → authorize → observe → review.
//
// The signing material below is deliberately public TEST material. It is not a
// secret, must never be funded, and must never be used outside this fixture.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeFunctionData, getAddress, hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  baseAgentSwapGuardIntentAsset,
  buildBaseAgentSwapGuardBoundIntents,
} from '../../sdk/dist/index.js'
import {
  buildAuthorization,
  authorizationTypedData,
  buildAuthorizationReceipt,
  buildAuthorizedReceipt,
  signReceipt,
} from '../../src/index.mjs'
import { signAuthorizationReceipt } from '../../src/domain/authorization.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

// Deterministic demo identities.
const insightAttester = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const principal = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const issuerSeed = '83'.repeat(32)
const issuerPrivateKeyPem = createPrivateKey({
  key: Buffer.from(`302e020100300506032b657004220420${issuerSeed}`, 'hex'),
  format: 'der',
  type: 'pkcs8',
}).export({ type: 'pkcs8', format: 'pem' }).toString()
const issuerPublicKeyPem = createPublicKey(issuerPrivateKeyPem)
  .export({ type: 'spki', format: 'pem' }).toString()

const issuer = 'priorseal-base-swap-guard-reference-test-issuer'
const keyId = 'base-swap-guard-reference-key-1'

// Synthetic but realistic Base mainnet references.
const wallet = principal.address
const weth = '0x4200000000000000000000000000000000000006'
const slipstreamRouter = '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5'
const cl100Pool = getAddress('0x32484957c8fa159e601984f4643fe5b6b0c6da9e')
const amountInRaw = '1000000000000000000'

// Deterministic fixture timeline (Unix seconds).
const now = 1_792_252_800
const validUntil = now + 60
const approvalAcceptedAt = now + 1
const swapAcceptedAt = now + 2
const approvalExecutedAt = now + 10
const approvalObservedAt = approvalExecutedAt + 1
const swapExecutedAt = now + 20
const swapObservedAt = swapExecutedAt + 1

const approvalData = encodeFunctionData({
  abi: [{
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  }] as const,
  functionName: 'approve',
  args: [slipstreamRouter, BigInt(amountInRaw)],
})
const swapData = encodeFunctionData({
  abi: [{
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'pool', type: 'address' },
        { name: 'recipient', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  }] as const,
  functionName: 'exactInputSingle',
  args: [{ pool: cl100Pool, recipient: wallet, amountIn: BigInt(amountInRaw), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
})

const insightDomain = { name: 'Insight Base Agent Swap Guard', version: '1', chainId: 1 } as const
const insightTypes = {
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

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
}

/** Stage 1 — assess: the signed Insight ALLOW with both exact calldata bindings. */
async function insightDecision() {
  const guard = {
    schema: 'insight.base-agent-swap-guard.v1' as const,
    verdict: 'ALLOW' as const,
    validUntil,
    scope: { chainId: 8453 as const, profileId: 'base-aerodrome-slipstream-weth-usdc-cl100', transactionAuthority: 'none' },
    market: { exactInput: { amountInRaw } },
    binding: {
      chainId: 8453 as const,
      recipient: wallet,
      approval: { token: weth, spender: slipstreamRouter, amountRaw: amountInRaw, calldataHash: keccak256(approvalData) },
      swap: { to: slipstreamRouter, value: '0x0' as const, calldataHash: keccak256(swapData) },
    },
    transactionsToSign: {
      approval: { to: weth, value: '0x0' as const, data: approvalData },
      swap: { to: slipstreamRouter, value: '0x0' as const, data: swapData },
    },
  }
  const decisionHash = keccak256(toBytes(canonical(guard)))
  const data = {
    decisionHash,
    approvalCalldataHash: keccak256(approvalData),
    swapCalldataHash: keccak256(swapData),
    recipient: wallet,
    chainId: 8453 as const,
    verdict: 0 as const,
    issuedAt: now,
    validUntil,
    schemaVersion: 1 as const,
  }
  const typedData = {
    domain: insightDomain,
    types: insightTypes,
    primaryType: 'BaseAgentSwapGuardDecision' as const,
    message: { ...data, chainId: 8453n, issuedAt: BigInt(now), validUntil: BigInt(validUntil), schemaVersion: 1n },
  }
  return {
    schema: 'insight.base-agent-swap-guard-decision.v1' as const,
    guard: { ...guard, decisionHash },
    decisionHash,
    attestation: {
      type: 'BaseAgentSwapGuardDecision' as const,
      schemaVersion: 1 as const,
      uid: hashTypedData(typedData),
      attester: insightAttester.address,
      attesterLabel: 'Insight Base Agent Swap Guard attester' as const,
      signedAt: new Date(now * 1000).toISOString(),
      validForSeconds: 60,
      signature: await insightAttester.signTypedData(typedData),
      verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/base-agent-swap-guard/verify',
      data,
      eip712: { domain: insightDomain, types: insightTypes, primaryType: 'BaseAgentSwapGuardDecision' },
    },
  }
}

function insightKeyRegistry() {
  return {
    schema: 'insight.keys.v1',
    keys: [{
      key_id: 'base-swap-guard-reference-attester',
      public_key: insightAttester.address,
      validFrom: new Date(0).toISOString(),
      validUntil: null,
      revoked: false,
      role: 'attester' as const,
    }],
  }
}

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

/** Stage 6 — close: Insight's signed settlement of the observed swap. */
async function settlementClosure(decisionHash: string, swapTxHash: string) {
  const reasonCodes: string[] = []
  const data = {
    decisionHash: decisionHash as `0x${string}`,
    swapTxHash: swapTxHash as `0x${string}`,
    approvalTxHash: `0x${sha256('synthetic:approval')}` as `0x${string}`,
    onChainSwapCalldataHash: keccak256(swapData),
    recipient: wallet,
    chainId: 8453 as const,
    fillStatus: 'FULL' as const,
    sourceAmountRaw: amountInRaw,
    destinationAmountRaw: '3200000000',
    executedPrice: '3200',
    realizedSlippageBps: '12.5',
    blockNumber: '27134567',
    executedAt: swapExecutedAt,
    checkedAt: swapObservedAt + 40,
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
    attester: insightAttester.address,
    attesterLabel: 'Insight Base Agent Swap Guard settlement attester' as const,
    signedAt: new Date(data.checkedAt * 1000).toISOString(),
    signature: await insightAttester.signTypedData(typedData),
    verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/base-agent-swap-guard/settlement',
    decisionHash: decisionHash as `0x${string}`,
    reasonCodes,
    data,
    eip712: { domain: settlementDomain, types: settlementTypes, primaryType: 'BaseAgentSwapGuardSettlement' },
  }
}

function issuerKeyRegistry() {
  return {
    schema: 'priorseal.keys.v1',
    issuer,
    keys: [{
      issuer,
      keyId,
      algorithm: 'Ed25519',
      publicKey: issuerPublicKeyPem,
      validFrom: null,
      validUntil: null,
      status: 'active',
    }],
  }
}

function writeJson(relativePath: string, value: unknown) {
  const path = join(directory, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Stage 3 — authorize: the principal signs each exact-call authorization. */
async function authorized(intent: unknown, expiresAt: number, authorizationNonce: string, acceptedAt: number) {
  const unsigned = buildAuthorization({
    intent,
    principal: { type: 'user', id: 'base-swap-guard-reference-principal', account: wallet },
    authorizer: { type: 'eip712', address: wallet },
    delegate: { agentId: 'base-swap-guard-reference-agent', executor: wallet },
    issuedAt: now,
    notBefore: now,
    expiresAt,
    authorizationNonce,
    maxUses: '1',
    audience: 'priorseal',
    policyHash: `0x${'00'.repeat(32)}`,
  })
  const authorization = buildAuthorization({ ...unsigned, signature: await principal.signTypedData(authorizationTypedData(unsigned)) })
  const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({
    authorization,
    issuer,
    keyId,
    acceptedAt,
  }), issuerPrivateKeyPem)
  return { authorization, acceptance }
}

function execution(caseId: string, target: string, calldataHash: string, nonce: string, executedAt: number, observedAt: number, asset: string, amount: string) {
  return {
    schema: 'priorseal.execution-observation.v1',
    chainId: 8453,
    txHash: `0x${sha256(`synthetic:${caseId}`)}`,
    status: 'CONFIRMED',
    blockNumber: 27_500_001,
    blockHash: `0x${'ac'.repeat(32)}`,
    executedAt,
    observedAt,
    action: 'CONTRACT_CALL',
    nonce,
    sender: wallet,
    recipient: target,
    target,
    calldataHash,
    asset,
    amount,
    nativeValue: '0',
    tokenValue: amount,
    transfers: [],
    transferMatchUnique: false,
    gasUsed: '21000',
    fee: null,
    executionDataAvailable: true,
    observationSource: 'synthetic-offline-fixture',
    finalityState: 'CONFIRMED',
    confirmations: 12,
  }
}

async function generateFixtures() {
  const decision = await insightDecision()

  // Stage 2 — bind: two ordered exact-call intents from the signed decision.
  const asset = baseAgentSwapGuardIntentAsset(weth)
  const { approval: approvalIntent, swap: swapIntent } = await buildBaseAgentSwapGuardBoundIntents({
    approval: {
      transaction: { chainId: 8453, from: wallet, to: weth, data: approvalData, nonce: '7', value: '0' },
      intentId: 'base-agent-swap-guard-approval-001',
      asset,
      amount: amountInRaw,
      validUntil: now + 100,
    },
    swap: {
      transaction: { chainId: 8453, from: wallet, to: slipstreamRouter, data: swapData, nonce: '8', value: '0' },
      intentId: 'base-agent-swap-guard-swap-001',
      asset,
      amount: amountInRaw,
      validUntil: now + 100,
    },
  }, decision, { keyRegistry: insightKeyRegistry(), now })

  const approval = await authorized(approvalIntent, validUntil, `0x${'92'.repeat(32)}`, approvalAcceptedAt)
  const swap = await authorized(swapIntent, validUntil, `0x${'93'.repeat(32)}`, swapAcceptedAt)

  // Stage 4 — observe: ordered synthetic executions, approval before swap.
  const approvalExecution = execution('approval', weth.toLowerCase(), keccak256(approvalData), '7', approvalExecutedAt, approvalObservedAt, asset, amountInRaw)
  const swapExecution = execution('swap', slipstreamRouter.toLowerCase(), keccak256(swapData), '8', swapExecutedAt, swapObservedAt, asset, amountInRaw)
  const approvalReceipt = signReceipt(buildAuthorizedReceipt({
    authorization: approval.authorization,
    acceptance: approval.acceptance,
    execution: approvalExecution,
    issuer,
    keyId,
    issuedAt: approvalObservedAt,
  }), issuerPrivateKeyPem)
  const swapReceipt = signReceipt(buildAuthorizedReceipt({
    authorization: swap.authorization,
    acceptance: swap.acceptance,
    execution: swapExecution,
    issuer,
    keyId,
    issuedAt: swapObservedAt,
  }), issuerPrivateKeyPem)

  // A fail-closed counterexample: a forged authorization whose own expiry
  // claims to outlive the signed Insight decision it binds to. The guard
  // rejects it on the window binding alone, before any signature is trusted.
  const outlivesAuthorization = structuredClone(approval.authorization) as { expiresAt: number }
  outlivesAuthorization.expiresAt = validUntil + 1

  // Stage 6 — close: Insight's settlement of the observed swap, bound to the
  // same synthetic execution the swap receipt observed, plus a contradictory
  // closure claiming a different executed transaction for fail-closed review.
  const swapTxHash = `0x${sha256('synthetic:swap')}`
  const settlement = await settlementClosure(decision.decisionHash, swapTxHash)
  const contradictorySettlement = await settlementClosure(decision.decisionHash, `0x${sha256('synthetic:swap:alternative')}`)

  writeJson('fixture/insight-decision.json', decision)
  writeJson('fixture/insight-key-registry.json', insightKeyRegistry())
  writeJson('fixture/issuer-key.json', issuerKeyRegistry())
  writeJson('fixture/intents.json', { approval: approvalIntent, swap: swapIntent })
  writeJson('fixture/authorizations/approval.json', approval.authorization)
  writeJson('fixture/authorizations/swap.json', swap.authorization)
  writeJson('fixture/authorizations/outlives.json', outlivesAuthorization)
  writeJson('fixture/receipts/approval.json', approvalReceipt)
  writeJson('fixture/receipts/swap.json', swapReceipt)
  writeJson('fixture/settlement.json', settlement)
  writeJson('fixture/settlement-contradictory.json', contradictorySettlement)

  const artifacts = [
    'fixture/insight-decision.json',
    'fixture/insight-key-registry.json',
    'fixture/issuer-key.json',
    'fixture/intents.json',
    'fixture/authorizations/approval.json',
    'fixture/authorizations/swap.json',
    'fixture/authorizations/outlives.json',
    'fixture/receipts/approval.json',
    'fixture/receipts/swap.json',
    'fixture/settlement.json',
    'fixture/settlement-contradictory.json',
  ].map((relativePath) => [relativePath, { sha256: sha256(readFileSync(join(directory, relativePath))) }])

  writeJson('MANIFEST.json', {
    schema: 'priorseal.fixture-manifest.v1',
    fixtureId: 'insight-base-agent-swap-guard-reference-v1',
    files: Object.fromEntries(artifacts),
    timeline: {
      insightIssuedAt: now,
      insightValidUntil: validUntil,
      approvalAcceptedAt,
      swapAcceptedAt,
      approvalExecutedAt,
      swapExecutedAt,
    },
  })
  return { decisionHash: decision.decisionHash }
}

const result = await generateFixtures()
console.log(JSON.stringify({ generated: 'insight-base-agent-swap-guard-reference-v1', decisionHash: result.decisionHash }))
