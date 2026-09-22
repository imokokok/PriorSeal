import { buildExactCallIntent } from './exact-call.js'
import { matchUniqueContextCommitment } from './context-commitment.js'
import {
  verifyRwaReport,
  rwaCanonicalJson,
  type RwaTrust,
  type SignedRwaReport,
} from './insight-rwa.js'
import type {
  ExactCallIntentInput,
  ExactCallTransaction,
  Intent,
} from './types.js'
import { verifyRwaReportV2, type SignedRwaReportV2, type RwaTrustV2 } from './insight-rwa-v2.js'

export const RWA_COMMITMENT_NAMESPACE = 'insight.rwa.assessment.v1'
export type RwaProof = SignedRwaReport | SignedRwaReportV2
export type RwaRequirement = { proof: RwaProof; trust: RwaTrust | RwaTrustV2 }
export const rwaAssessment = (p: RwaProof) => p.report.schema === 'insight.rwa-report.v2' ? p.report.assessment : p.report
function canonicalTrust(trust: RwaTrust | RwaTrustV2) {
  return rwaCanonicalJson({ ...trust, keys: trust.keys.map(k => ({ ...k, address: k.address.toLowerCase() })).sort((a, b) => a.address.localeCompare(b.address)) })
}
function commitment(r: RwaRequirement) {
  return {
    namespace: r.proof.report.schema === 'insight.rwa-report.v2' ? 'insight.rwa.assessment.v2' : RWA_COMMITMENT_NAMESPACE,
    algorithm: 'keccak256' as const,
    digest: r.proof.digest,
  }
}
function checkScope(intent: Intent, r: RwaRequirement) {
  const request = r.trust.request,
    call = request.call,
    instrument = rwaAssessment(r.proof).input.instrument
  const expectedAsset = `eip155:${instrument.tokenChainId}/erc20:${instrument.tokenAddress}`
  if (
    intent.schema !== 'priorseal.intent.v2' ||
    intent.executionProfile !== 'priorseal.execution-profile.exact-call.v1' ||
    intent.action !== 'CONTRACT_CALL' ||
    intent.asset !== expectedAsset ||
    intent.amount !== request.amount ||
    Number(intent.chainId) !== call.chainId ||
    intent.sender !== call.from ||
    intent.callTarget !== call.to ||
    intent.recipient !== call.to ||
    intent.calldataHash !== call.calldataHash ||
    intent.transactionValue !== call.value ||
    intent.nonce !== call.nonce
  )
    throw new Error('RWA_CALL_SCOPE_MISMATCH')
}
async function requireReport(r: RwaRequirement, now: number) {
  const result = r.proof.report.schema === 'insight.rwa-report.v2'
    ? await verifyRwaReportV2(r.proof as SignedRwaReportV2, r.trust as RwaTrustV2, now)
    : await verifyRwaReport(r.proof as SignedRwaReport, r.trust, now)
  if (!result.valid) throw new Error(`RWA_BLOCKED:${result.reasons.join(',')}`)
}
function checkBinding(intent: Intent, r: RwaRequirement, now: number) {
  checkScope(intent, r)
  if (!matchUniqueContextCommitment(intent, commitment(r)).matched)
    throw new Error('RWA_AUTHORIZATION_BINDING_MISMATCH')
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(intent.validUntil) ||
    intent.validUntil > r.proof.report.validUntil ||
    now >= intent.validUntil
  )
    throw new Error('RWA_AUTHORIZATION_EXPIRED')
}
/** Opt-in. Other context commitments, legacy policies and schemas are preserved. */
export async function buildRwaBoundIntent(
  input: ExactCallIntentInput,
  requirement: RwaRequirement,
  now = Math.floor(Date.now() / 1000),
): Promise<Intent> {
  input = structuredClone(input)
  requirement = structuredClone(requirement)
  await requireReport(requirement, now)
  if (
    input.contextCommitments?.some(
      (c) => [RWA_COMMITMENT_NAMESPACE, 'insight.rwa.assessment.v2'].includes(c.namespace.toLowerCase()),
    )
  )
    throw new Error('RWA_RESERVED_NAMESPACE')
  const intent = buildExactCallIntent({
    ...input,
    validUntil: Math.min(input.validUntil, requirement.proof.report.validUntil),
    contextCommitments: [
      ...(input.contextCommitments ?? []),
      commitment(requirement),
    ],
  })
  checkBinding(intent, requirement, now)
  return intent
}

/** Fresh, separately signed execution evidence plus the original principal-bound report.
 * The callback must additionally enforce principal authorization/replay and submit this call.
 */
export async function withRwaExecutionPair<T>(
  input: {
    intent: Intent
    authority: RwaRequirement
    execution: RwaRequirement
    authorityTime: number
  },
  transaction: ExactCallTransaction,
  action: (transaction: ExactCallTransaction) => Promise<T>,
  clock: () => number = () => Math.floor(Date.now() / 1000),
): Promise<T> {
  const pinned = structuredClone(input),
    call = structuredClone(transaction)
  const result = await verifyRwaExecutionPair({
    ...pinned,
    executionTime: clock(),
  })
  if (!result.valid)
    throw new Error(`RWA_EXECUTION_BLOCKED:${result.reasons.join(',')}`)
  const actual = buildExactCallIntent({
    transaction: call,
    intentId: pinned.intent.intentId,
    asset: pinned.intent.asset,
    amount: pinned.intent.amount,
    validUntil: pinned.intent.validUntil,
  })
  checkScope(actual, pinned.execution)
  const now = clock()
  checkBinding(pinned.intent, pinned.authority, now)
  if (
    now < rwaAssessment(pinned.execution.proof).evaluatedAt ||
    now >= pinned.execution.proof.report.validUntil
  )
    throw new Error('RWA_EXECUTION_EXPIRED')
  return action(call)
}

/** Verify principal authorization separately. Pass the actual transaction at signer entry. */
export async function withRwaBoundIntent<T>(
  intent: Intent,
  requirement: RwaRequirement,
  transaction: ExactCallTransaction,
  action: (transaction: ExactCallTransaction) => Promise<T>,
  clock: () => number = () => Math.floor(Date.now() / 1000),
): Promise<T> {
  // Snapshot before the first await: caller mutation cannot replace the admitted call or pins.
  const pinnedIntent = structuredClone(intent),
    pinned = structuredClone(requirement),
    call = structuredClone(transaction)
  await requireReport(pinned, clock())
  checkBinding(pinnedIntent, pinned, clock())
  const actual = buildExactCallIntent({
    transaction: call,
    intentId: pinnedIntent.intentId,
    asset: pinnedIntent.asset,
    amount: pinnedIntent.amount,
    validUntil: pinnedIntent.validUntil,
  })
  checkScope(actual, pinned)
  // Cryptographic verification can consume the remaining evidence lifetime.
  checkBinding(pinnedIntent, pinned, clock())
  return action(call)
}

/** Evaluate later evidence without pretending it existed when the principal authorized. */
export async function verifyRwaExecutionPair(input: {
  intent: Intent
  authority: RwaRequirement
  execution: RwaRequirement
  authorityTime: number
  executionTime: number
}): Promise<{
  valid: boolean
  reasons: string[]
  executionEvidenceDigest: string | null
}> {
  try {
    const { intent, authority, execution, authorityTime, executionTime } =
      structuredClone(input)
    if (
      !Number.isSafeInteger(authorityTime) ||
      !Number.isSafeInteger(executionTime) ||
      executionTime < authorityTime
    )
      throw new Error('RWA_PAIR_TIMELINE_INVALID')
    await requireReport(authority, authorityTime)
    checkBinding(intent, authority, authorityTime)
    checkBinding(intent, authority, executionTime)
    const a = authority.proof.report, e = execution.proof.report
    if (a.schema !== e.schema) throw new Error('RWA_PAIR_VERSION_MISMATCH')
    const ordered = a.schema === 'insight.rwa-report.v2' && e.schema === 'insight.rwa-report.v2'
      ? BigInt(e.sequence) === BigInt(a.sequence) + 1n && e.previousDigest === authority.proof.digest && e.assessment.evaluatedAt >= a.assessment.evaluatedAt
      : rwaAssessment(execution.proof).evaluatedAt > rwaAssessment(authority.proof).evaluatedAt
    if (
      authority.proof.digest === execution.proof.digest || !ordered ||
      rwaAssessment(execution.proof).evaluatedAt < authorityTime
    )
      throw new Error('RWA_EXECUTION_EVIDENCE_NOT_DISTINCT')
    if (canonicalTrust(authority.trust) !== canonicalTrust(execution.trust))
      throw new Error('RWA_PAIR_TRUST_MISMATCH')
    await requireReport(execution, executionTime)
    checkScope(intent, execution)
    return {
      valid: true,
      reasons: [],
      executionEvidenceDigest: execution.proof.digest,
    }
  } catch (error) {
    return {
      valid: false,
      reasons: [error instanceof Error ? error.message : 'RWA_PAIR_INVALID'],
      executionEvidenceDigest: null,
    }
  }
}
