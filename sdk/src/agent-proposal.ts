import { matchUniqueContextCommitment } from './context-commitment.js'
import type { ContextCommitment, ContextCommitmentMatch, Intent } from './types.js'

/** The opaque intent commitment created from a separately retained proposal record. */
export const AGENT_PROPOSAL_NAMESPACE = 'priorseal.agent-proposal.v1'

/**
 * A compact, user-displayable disclosure from an Agent or its host application.
 * It describes why an exact action was proposed; it is never an authorization,
 * identity attestation, performance claim, or investment recommendation.
 */
export type AgentProposal = {
  schema: 'priorseal.agent-proposal.v1'
  agentId: string
  proposalId: string
  createdAt: number
  rationale: string
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/** Validate and normalize an application-owned Agent identifier. */
export function assertAgentId(value: unknown): string {
  if (typeof value !== 'string' || !identifier.test(value)) {
    throw new TypeError('agentId must use 1–128 letters, digits, dots, underscores, hyphens, or colons, and begin with a letter or digit')
  }
  return value
}

/** Build a strict, portable proposal record before it is committed into an intent. */
export function createAgentProposal(input: Omit<AgentProposal, 'schema'>): AgentProposal {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('agent proposal is required')
  const agentId = assertAgentId(input.agentId)
  if (typeof input.proposalId !== 'string' || !identifier.test(input.proposalId)) throw new TypeError('proposalId is invalid')
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) throw new TypeError('proposal createdAt must be a non-negative Unix timestamp')
  if (typeof input.rationale !== 'string' || input.rationale.length < 1 || input.rationale.length > 280 || input.rationale.trim() !== input.rationale || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(input.rationale)) {
    throw new TypeError('proposal rationale must be 1–280 text characters without leading or trailing whitespace')
  }
  return { schema: 'priorseal.agent-proposal.v1', agentId, proposalId: input.proposalId, createdAt: input.createdAt, rationale: input.rationale }
}

/** Parse only the exact public record shape; untrusted extras are rejected. */
export function parseAgentProposal(value: unknown): AgentProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('agent proposal is required')
  const record = value as Record<string, unknown>
  const expected = ['agentId', 'createdAt', 'proposalId', 'rationale', 'schema']
  const keys = Object.keys(record).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) || record.schema !== 'priorseal.agent-proposal.v1') throw new TypeError('agent proposal has an unsupported field set')
  return createAgentProposal({ agentId: record.agentId as string, proposalId: record.proposalId as string, createdAt: record.createdAt as number, rationale: record.rationale as string })
}

/** Exact canonical bytes that are SHA-256 committed into the PriorSeal intent. */
export function canonicalAgentProposalBytes(value: AgentProposal): Uint8Array {
  const proposal = parseAgentProposal(value)
  return new TextEncoder().encode(`{"agentId":${JSON.stringify(proposal.agentId)},"createdAt":${proposal.createdAt},"proposalId":${JSON.stringify(proposal.proposalId)},"rationale":${JSON.stringify(proposal.rationale)},"schema":"priorseal.agent-proposal.v1"}`)
}

/** Create the context commitment that a prepared action can carry without publishing the rationale. */
export async function agentProposalCommitment(value: AgentProposal): Promise<ContextCommitment> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(canonicalAgentProposalBytes(value)).buffer)
  return { namespace: AGENT_PROPOSAL_NAMESPACE, algorithm: 'sha256', digest: `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}` }
}

/** Check that a retained proposal record is the one committed into an intent. */
export async function verifyAgentProposalCommitment(intent: Pick<Intent, 'contextCommitments'>, value: AgentProposal): Promise<ContextCommitmentMatch> {
  return matchUniqueContextCommitment(intent, await agentProposalCommitment(value))
}
