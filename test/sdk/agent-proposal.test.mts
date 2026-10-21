import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AGENT_PROPOSAL_NAMESPACE,
  agentProposalCommitment,
  canonicalAgentProposalBytes,
  createAgentProposal,
  parseAgentProposal,
  verifyAgentProposalCommitment,
} from '../../sdk/dist/index.js'

const proposal = createAgentProposal({
  agentId: 'agent:research-copilot',
  proposalId: 'proposal:usdc-sol-001',
  createdAt: 1_800_000_000,
  rationale: 'The user requested one bounded USDC-to-SOL conversion for review.',
})

test('Agent proposal records are canonical, compact, and bound through one context commitment', async () => {
  const commitment = await agentProposalCommitment(proposal)
  assert.equal(commitment.namespace, AGENT_PROPOSAL_NAMESPACE)
  assert.equal(commitment.algorithm, 'sha256')
  assert.match(commitment.digest, /^0x[0-9a-f]{64}$/)
  assert.equal(new TextDecoder().decode(canonicalAgentProposalBytes(proposal)), '{"agentId":"agent:research-copilot","createdAt":1800000000,"proposalId":"proposal:usdc-sol-001","rationale":"The user requested one bounded USDC-to-SOL conversion for review.","schema":"priorseal.agent-proposal.v1"}')
  assert.deepEqual(await verifyAgentProposalCommitment({ contextCommitments: [commitment] }, proposal), { matched: true, code: 'OK', commitment })
})

test('Agent proposal parsing rejects extra fields, invisible controls, and mutable identity strings', () => {
  assert.throws(() => parseAgentProposal({ ...proposal, unsupported: true }), /unsupported field set/)
  assert.throws(() => createAgentProposal({ agentId: proposal.agentId, proposalId: proposal.proposalId, createdAt: proposal.createdAt, rationale: 'leading whitespace is rejected ' }), /rationale/)
  assert.throws(() => createAgentProposal({ agentId: ' agent:research-copilot', proposalId: proposal.proposalId, createdAt: proposal.createdAt, rationale: proposal.rationale }), /agentId/)
})
