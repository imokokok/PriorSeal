import type { ContextCommitment, ContextCommitmentMatch, Intent } from './types.js'

/**
 * Match an expected external assessment or approval digest against the exact
 * commitments carried by an intent. This is a structural check only: verify
 * the containing authorization or receipt separately to establish authority.
 */
export function matchContextCommitment(
  intent: Pick<Intent, 'contextCommitments'>,
  expected: ContextCommitment,
): ContextCommitmentMatch {
  const normalized = normalize(expected)
  const commitments = intent.contextCommitments ?? []
  const sameNamespace = commitments.filter((entry) => entry.namespace === normalized.namespace)
  if (sameNamespace.length === 0) {
    return { matched: false, code: 'CONTEXT_COMMITMENT_MISSING', commitment: null }
  }
  const exact = sameNamespace.find((entry) => {
    const candidate = normalize(entry)
    return candidate.algorithm === normalized.algorithm && candidate.digest === normalized.digest
  })
  if (exact) return { matched: true, code: 'OK', commitment: normalize(exact) }
  if (!sameNamespace.some((entry) => entry.algorithm === normalized.algorithm)) {
    return { matched: false, code: 'CONTEXT_COMMITMENT_ALGORITHM_MISMATCH', commitment: null }
  }
  return { matched: false, code: 'CONTEXT_COMMITMENT_DIGEST_MISMATCH', commitment: null }
}

/**
 * Strict variant for composition layers that require one unambiguous reference
 * per namespace. PriorSeal still treats the referenced content as opaque.
 */
export function matchUniqueContextCommitment(
  intent: Pick<Intent, 'contextCommitments'>,
  expected: ContextCommitment,
): ContextCommitmentMatch {
  const normalized = normalize(expected)
  const sameNamespace = (intent.contextCommitments ?? []).filter(
    (entry) => normalize(entry).namespace === normalized.namespace,
  )
  if (sameNamespace.length > 1) {
    return { matched: false, code: 'CONTEXT_COMMITMENT_AMBIGUOUS', commitment: null }
  }
  return matchContextCommitment(intent, normalized)
}

function normalize(commitment: ContextCommitment): ContextCommitment {
  const namespace = commitment?.namespace?.trim()
  const algorithm = commitment?.algorithm
  const digest = commitment?.digest?.toLowerCase()
  if (!namespace || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(namespace)) {
    throw new TypeError('context commitment namespace is invalid')
  }
  if (algorithm !== 'keccak256' && algorithm !== 'sha256') {
    throw new TypeError('context commitment algorithm must be keccak256 or sha256')
  }
  if (!/^0x[0-9a-f]{64}$/.test(digest ?? '')) {
    throw new TypeError('context commitment digest must be 32-byte hex')
  }
  return { namespace, algorithm, digest }
}
