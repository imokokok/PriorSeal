import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AGENT_SWAP_GUARD_CHAIN_IDS,
  BASE_AGENT_SWAP_GUARD_CHAIN_IDS,
  agentSwapGuardCommitment,
  agentSwapGuardIntentAsset,
  baseAgentSwapGuardCommitment,
  baseAgentSwapGuardIntentAsset,
  buildAgentSwapGuardBoundIntents,
  buildBaseAgentSwapGuardBoundIntents,
  detectInsightAgentSwapGuardSettlementContradictions,
  detectInsightBaseAgentSwapGuardSettlementContradictions,
  verifyAgentSwapGuardAuthorizationBundle,
  verifyAgentSwapGuardReceiptBundle,
  verifyBaseAgentSwapGuardAuthorizationBundle,
  verifyBaseAgentSwapGuardReceiptBundle,
  verifyAgentSwapGuardSettlementForDecision,
  verifyBaseAgentSwapGuardSettlementForDecision,
  verifyInsightAgentSwapGuardDecision,
  verifyInsightBaseAgentSwapGuardDecision,
  verifyInsightAgentSwapGuardSettlement,
  verifyInsightBaseAgentSwapGuardSettlement,
} from '../../sdk/dist/index.js'

test('neutral Agent Swap Guard SDK names preserve the multichain implementation', () => {
  assert.deepEqual(AGENT_SWAP_GUARD_CHAIN_IDS, BASE_AGENT_SWAP_GUARD_CHAIN_IDS)
  assert.equal(agentSwapGuardCommitment, baseAgentSwapGuardCommitment)
  assert.equal(agentSwapGuardIntentAsset, baseAgentSwapGuardIntentAsset)
  assert.equal(buildAgentSwapGuardBoundIntents, buildBaseAgentSwapGuardBoundIntents)
  assert.equal(verifyInsightAgentSwapGuardDecision, verifyInsightBaseAgentSwapGuardDecision)
  assert.equal(verifyAgentSwapGuardAuthorizationBundle, verifyBaseAgentSwapGuardAuthorizationBundle)
  assert.equal(verifyAgentSwapGuardReceiptBundle, verifyBaseAgentSwapGuardReceiptBundle)
})

test('neutral settlement SDK names preserve the signed evidence implementation', () => {
  assert.equal(verifyInsightAgentSwapGuardSettlement, verifyInsightBaseAgentSwapGuardSettlement)
  assert.equal(verifyAgentSwapGuardSettlementForDecision, verifyBaseAgentSwapGuardSettlementForDecision)
  assert.equal(
    detectInsightAgentSwapGuardSettlementContradictions,
    detectInsightBaseAgentSwapGuardSettlementContradictions,
  )
})
