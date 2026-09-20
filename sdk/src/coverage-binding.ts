import { verifyCoverageReport, type CoverageTrust, type SignedCoverageReport } from './insight-coverage.js'
import { buildExactCallIntent } from './exact-call.js'
import { matchUniqueContextCommitment } from './context-commitment.js'
import type { ExactCallIntentInput, Intent } from './types.js'

export type CoverageRequirement = { side: 'source' | 'destination'; proof: SignedCoverageReport; trust: CoverageTrust }

/** Consumer opt-in. Coverage evidence chain need not be the transaction's settlement chain. */
export async function buildCoverageBoundIntent(input: ExactCallIntentInput, requirements: CoverageRequirement[], now = Math.floor(Date.now() / 1000)): Promise<Intent> {
  await checkRequirements(requirements, now)
  const commitments = requirements.map(r => coverageCommitment(r))
  if (input.contextCommitments?.some(c => c.namespace.startsWith('insight.coverage.'))) throw new Error('Reserved coverage commitment namespace')
  const validUntil = Math.min(input.validUntil, ...requirements.map(r => r.proof.report.validUntil))
  return buildExactCallIntent({ ...input, validUntil, contextCommitments: [...(input.contextCommitments ?? []), ...commitments] })
}

/** Call after principal authorization and immediately before provider entry. Verify authorization separately. */
export async function withCoverageBoundIntent<T>(intent: Intent, requirements: CoverageRequirement[], action: () => Promise<T>, clock: () => number = () => Math.floor(Date.now() / 1000)): Promise<T> {
  await checkRequirements(requirements, clock())
  if (intent.schema !== 'priorseal.intent.v2' || intent.executionProfile !== 'priorseal.execution-profile.exact-call.v1' || !Number.isSafeInteger(intent.validUntil)) throw new Error('Coverage requires an exact-call intent')
  const expected = requirements.map(coverageCommitment)
  const actual = intent.contextCommitments?.filter(c => c.namespace.startsWith('insight.coverage.')) ?? []
  if (actual.length !== expected.length || expected.some(c => !matchUniqueContextCommitment(intent, c).matched)) throw new Error('Coverage authorization binding mismatch')
  if (intent.validUntil > Math.min(...requirements.map(r => r.proof.report.validUntil)) || clock() >= intent.validUntil) throw new Error('Coverage authorization expired or exceeds report validity')
  return action()
}

function coverageCommitment(r: CoverageRequirement) {
  return { namespace: `insight.coverage.${r.side}.v1`, algorithm: 'keccak256' as const, digest: r.proof.digest }
}
async function checkRequirements(requirements: CoverageRequirement[], now: number) {
  if (!Array.isArray(requirements) || requirements.length < 1 || requirements.length > 2 || new Set(requirements.map(r => r.side)).size !== requirements.length || requirements.some(r => !['source', 'destination'].includes(r.side))) throw new Error('Invalid coverage requirements')
  for (const r of requirements) {
    const result = await verifyCoverageReport(r.proof, r.trust, now)
    if (!result.valid) throw new Error(`Coverage blocked: ${result.reasons.join(',')}`)
  }
}
