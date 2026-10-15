import assert from 'node:assert/strict'
import test from 'node:test'
import type { Address, Hash, Hex } from 'viem'
import {
  buildExactCallIntent,
  createERC8004TrustDecisionBundle,
  erc8004IdentitySnapshotCommitment,
  formatERC8004AgentRef,
  readERC8004Reputation,
  readERC8004Validations,
  resolveERC8004Identity,
  verifyERC8004AuthorizationBinding,
  verifyERC8004AuthorizationTrustDecision,
} from '../../sdk/dist/index.js'

const identityRegistry = '0x1111111111111111111111111111111111111111' as Address
const reputationRegistry = '0x2222222222222222222222222222222222222222' as Address
const validationRegistry = '0x3333333333333333333333333333333333333333' as Address
const owner = '0x4444444444444444444444444444444444444444' as Address
const executor = '0x5555555555555555555555555555555555555555' as Address
const reviewer = '0x6666666666666666666666666666666666666666' as Address
const validator = '0x7777777777777777777777777777777777777777' as Address
const validationRequestHash = `0x${'c'.repeat(64)}` as Hash
const validationResponseHash = `0x${'d'.repeat(64)}` as Hash
const blockHash = `0x${'a'.repeat(64)}` as Hash
const blockTimestamp = 1_800_000_000n
const assessedAt = Number(blockTimestamp + 100n)
const registryCode = '0x60006000' as Hex

const agentRef = formatERC8004AgentRef({ chainId: 84532, identityRegistry, agentId: '42' })
const reputationPolicy = {
  trustedReviewers: [reviewer],
  minimumFeedbackCount: 1,
  minimumDistinctReviewers: 1,
  requiredTag1: 'authorization-compliance',
}
const validationPolicy = {
  trustedValidators: [validator],
  minimumResponse: 100,
  requiredTag: 'production-readiness',
  maxAgeSeconds: 3600,
}
const trustOptions = {
  identityRegistry: { trustedRegistryAddresses: [identityRegistry] },
  reputationRegistry: { trustedRegistryAddresses: [reputationRegistry] },
  validationRegistry: { trustedRegistryAddresses: [validationRegistry] },
}

function makeReadClient() {
  return {
    async getChainId() { return 84532 },
    async getBlockNumber() { return 100n },
    async getBlock() { return { hash: blockHash, timestamp: blockTimestamp } },
    async getCode() { return registryCode },
    async readContract(request: { address: Address; functionName: string; args?: readonly unknown[] }) {
      if (request.address === identityRegistry) {
        if (request.functionName === 'ownerOf') return owner
        if (request.functionName === 'getAgentWallet') return executor
        if (request.functionName === 'tokenURI') return 'https://agents.example/42.json'
      }
      if (request.address === reputationRegistry) {
        if (request.functionName === 'getIdentityRegistry') return identityRegistry
        if (request.functionName === 'getLastIndex') return 1n
        if (request.functionName === 'readFeedback') return [10n, 0, 'authorization-compliance', '', false] as const
      }
      if (request.address === validationRegistry) {
        if (request.functionName === 'getIdentityRegistry') return identityRegistry
        if (request.functionName === 'getValidationStatus') {
          return [validator, 42n, 100, validationResponseHash, 'production-readiness', blockTimestamp + 50n] as const
        }
      }
      throw new Error(`Unexpected mock read: ${request.address}.${request.functionName}(${request.args?.join(',') ?? ''})`)
    },
  }
}

test('ERC-8004 evidence flows into a PriorSeal intent context and re-verifies end to end', async () => {
  const client = makeReadClient()
  const identitySnapshot = await resolveERC8004Identity(client as never, agentRef, {
    trustedRegistryAddresses: [identityRegistry],
    executor,
  })
  assert.equal(identitySnapshot.bindingStatus, 'MATCH')

  const reputation = await readERC8004Reputation(client as never, agentRef, reputationRegistry, reputationPolicy, {
    trustedRegistryAddresses: [reputationRegistry],
    maxFeedbackPerReviewer: 8,
  })
  const validations = await readERC8004Validations(client as never, agentRef, validationRegistry, [validationRequestHash], {
    trustedRegistryAddresses: [validationRegistry],
  })
  const bundle = await createERC8004TrustDecisionBundle(client as never, {
    identitySnapshot,
    reputation: { snapshot: reputation, policy: reputationPolicy },
    validations: { snapshot: validations, policy: validationPolicy },
    assessedAt,
  }, trustOptions)

  const intent = buildExactCallIntent({
    transaction: {
      chainId: 84532,
      from: executor,
      to: '0x8888888888888888888888888888888888888888',
      data: '0x1234',
      nonce: 7,
      value: 0,
    },
    intentId: 'erc8004-landing-chain-1',
    asset: 'eip155:84532/native',
    amount: '0',
    validUntil: assessedAt + 300,
    contextCommitments: [erc8004IdentitySnapshotCommitment(identitySnapshot), bundle.commitment],
  })
  const authorization = {
    schema: 'priorseal.authorization.v2',
    delegate: { agentId: agentRef, executor },
    issuedAt: assessedAt + 10,
    intent,
  }

  const identityBinding = await verifyERC8004AuthorizationBinding(
    authorization as never,
    identitySnapshot,
    client as never,
    { trustedRegistryAddresses: [identityRegistry] },
  )
  const trustBinding = await verifyERC8004AuthorizationTrustDecision(authorization, bundle, client as never, trustOptions)
  assert.equal(identityBinding.valid, true)
  assert.equal(identityBinding.chainStateVerified, true)
  assert.equal(trustBinding.valid, true)
  assert.equal(trustBinding.commitmentMatched, true)
  assert.equal(trustBinding.trustDecision.reputationVerified, true)
  assert.equal(trustBinding.trustDecision.validationsVerified, true)
})

test('ERC-8004 binding fails closed when the identity snapshot is altered after intent construction', async () => {
  const client = makeReadClient()
  const identitySnapshot = await resolveERC8004Identity(client as never, agentRef, {
    trustedRegistryAddresses: [identityRegistry],
    executor,
  })
  const intent = buildExactCallIntent({
    transaction: {
      chainId: 84532,
      from: executor,
      to: '0x8888888888888888888888888888888888888888',
      data: '0x1234',
      nonce: 7,
    },
    intentId: 'erc8004-landing-chain-2',
    asset: 'eip155:84532/native',
    amount: '0',
    validUntil: assessedAt + 300,
    contextCommitments: [erc8004IdentitySnapshotCommitment(identitySnapshot)],
  })
  const authorization = {
    schema: 'priorseal.authorization.v2',
    delegate: { agentId: agentRef, executor },
    issuedAt: assessedAt + 10,
    intent,
  }
  const alteredSnapshot = { ...identitySnapshot, tokenURI: 'https://attacker.example/replaced.json' }
  const result = await verifyERC8004AuthorizationBinding(
    authorization as never,
    alteredSnapshot,
    client as never,
    { trustedRegistryAddresses: [identityRegistry] },
  )
  assert.equal(result.valid, false)
  assert.equal(result.code, 'IDENTITY_SNAPSHOT_COMMITMENT_MISMATCH')
})
