import { buildExactCallIntent } from './exact-call.js'
import type { ContextCommitment, ExactCallIntentInput, Intent } from './types.js'

/**
 * The Chirindo H4 checker binds the SHA-256 hash of the destination log entry
 * to bytes signed by the eventual Base transaction authorizer.  This is the
 * PriorSeal-side context namespace for that same value.  It is intentionally
 * opt-in: adding this helper does not activate any partner route or alter an
 * existing authorization flow.
 */
export const HEADLESS_H4_ENTRY_HASH_NAMESPACE = 'headless.h4.entry-hash.v1'

export type HeadlessH4EntryHash = `sha256:${string}`

export interface HeadlessH4ExactCallInput extends Omit<ExactCallIntentInput, 'contextCommitments'> {
  /** `sha256:<64 lowercase hex>` for the destination Chirindo log entry. */
  entryHash: string
  /** Other independently scoped commitments to preserve in the authorization. */
  contextCommitments?: ContextCommitment[]
}

/**
 * Parse the log representation required by Chirindo and return the exact raw
 * 32-byte value that must occur in the authorizer-signed calldata.
 */
export function parseHeadlessH4EntryHash(value: unknown): HeadlessH4EntryHash {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new TypeError('Headless H4 entryHash must be sha256:<64 lowercase hex>')
  }
  return value as HeadlessH4EntryHash
}

/** Convert an H4 entry hash into the exact context commitment PriorSeal signs. */
export function headlessH4EntryHashCommitment(value: unknown): ContextCommitment {
  const entryHash = parseHeadlessH4EntryHash(value)
  return {
    namespace: HEADLESS_H4_ENTRY_HASH_NAMESPACE,
    algorithm: 'sha256',
    digest: `0x${entryHash.slice('sha256:'.length)}`,
  }
}

/**
 * Build an exact-call intent only when its *actual calldata* contains the
 * destination log-entry hash.  `buildExactCallIntent` then signs the
 * calldata's keccak256 alongside the SHA-256 context commitment, so changing
 * either the call bytes or the H4 entry invalidates the authorization.
 *
 * This is a preparation guard, not a transaction broadcaster.  Callers must
 * still preflight the target's handling of trailing calldata and submit these
 * same bytes from the stated authorizer; a relayer-signed transaction does not
 * meet the external H4 checker's authorizer-binding condition.
 */
export function buildHeadlessH4ExactCallIntent(input: HeadlessH4ExactCallInput): Intent {
  const commitment = headlessH4EntryHashCommitment(input.entryHash)
  const calldata = input.transaction?.data
  if (typeof calldata !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(calldata)) {
    throw new TypeError('transaction.data must be 0x-prefixed bytes')
  }
  if (!calldata.slice(2).toLowerCase().includes(commitment.digest.slice(2))) {
    throw new TypeError('transaction.data must carry the Headless H4 destination entry hash')
  }

  const supplied = input.contextCommitments ?? []
  const h4Commitments = supplied.filter((item) => item?.namespace === HEADLESS_H4_ENTRY_HASH_NAMESPACE)
  if (h4Commitments.some((item) => item.algorithm !== commitment.algorithm || item.digest.toLowerCase() !== commitment.digest)) {
    throw new TypeError('contextCommitments contains a conflicting Headless H4 entry hash')
  }
  if (h4Commitments.length > 1) {
    throw new TypeError('contextCommitments contains the Headless H4 entry hash more than once')
  }

  return buildExactCallIntent({
    ...input,
    contextCommitments: h4Commitments.length === 1 ? supplied : [...supplied, commitment],
  })
}
