import { matchUniqueContextCommitment } from './context-commitment.js'
import type { ContextCommitment, ContextCommitmentMatch, Intent } from './types.js'

export const WEB3_AGENT_KIT_CALL_ENVELOPE_NAMESPACE = 'agent-call-envelope.v1' as const
export const WEB3_AGENT_KIT_POLICY_DECISION_NAMESPACE = 'web3-agent-kit.policy-decision.v1' as const

export type Web3AgentKitContextCommitmentInput = {
  callEnvelopeDigest: string
  policyDecisionDigest?: string
}

/**
 * Bind Web3 Agent Kit's already-canonical CallEnvelopeV1 digest directly.
 *
 * PriorSeal deliberately does not parse, normalize, or hash the envelope a
 * second time. Web3 Agent Kit remains the single source of truth for the
 * `agent-call-envelope.v1` canonical bytes. PriorSeal lowercases the hex
 * spelling only, then carries the exact 32-byte digest in the signed intent.
 * The policy decision stays in its own hash domain.
 */
export function web3AgentKitContextCommitments(
  input: Web3AgentKitContextCommitmentInput,
): ContextCommitment[] {
  const commitments = [
    commitment(WEB3_AGENT_KIT_CALL_ENVELOPE_NAMESPACE, input.callEnvelopeDigest),
  ]
  if (input.policyDecisionDigest !== undefined) {
    commitments.push(
      commitment(WEB3_AGENT_KIT_POLICY_DECISION_NAMESPACE, input.policyDecisionDigest),
    )
  }
  return commitments
}

/** Match the exact WAK envelope digest carried by a PriorSeal intent. */
export function matchWeb3AgentKitCallEnvelope(
  intent: Pick<Intent, 'contextCommitments'>,
  callEnvelopeDigest: string,
): ContextCommitmentMatch {
  return matchUniqueContextCommitment(
    intent,
    commitment(WEB3_AGENT_KIT_CALL_ENVELOPE_NAMESPACE, callEnvelopeDigest),
  )
}

function commitment(namespace: string, digest: string): ContextCommitment {
  const normalizedDigest = String(digest).toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(normalizedDigest)) {
    throw new TypeError('Web3 Agent Kit digest must be 32-byte 0x-prefixed hex')
  }
  return { namespace, algorithm: 'sha256', digest: normalizedDigest }
}
