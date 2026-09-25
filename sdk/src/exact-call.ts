import { keccak256 } from 'viem'
import type { ContextCommitment, ExactCallIntentInput, Intent } from './types.js'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Parse an imported transaction before it enters the typed authorization flow. */
export function parseExactCallTransaction(value: unknown): ExactCallIntentInput['transaction'] {
  if (!record(value)) throw new TypeError('Transaction JSON must be an object')
  if (typeof value.chainId !== 'number' || !Number.isSafeInteger(value.chainId) || value.chainId < 1) throw new TypeError('transaction.chainId must be a positive JSON integer')
  address(value.from, 'transaction.from')
  address(value.to, 'transaction.to')
  if (typeof value.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value.data)) throw new TypeError('transaction.data must be 0x-prefixed bytes')
  if (typeof value.nonce !== 'string' && typeof value.nonce !== 'number') throw new TypeError('transaction.nonce must be an unsigned integer')
  uintString(value.nonce, 'transaction.nonce')
  if (value.value !== undefined) {
    if (typeof value.value !== 'string' && typeof value.value !== 'number') throw new TypeError('transaction.value must be an unsigned integer')
    uintString(value.value, 'transaction.value')
  }
  return { chainId: value.chainId, from: value.from as string, to: value.to as string, data: value.data as `0x${string}`, nonce: value.nonce, ...(value.value === undefined ? {} : { value: value.value }) }
}

export function parseContextCommitments(value: unknown): ContextCommitment[] {
  if (!Array.isArray(value) || value.some((entry) => !record(entry) || typeof entry.namespace !== 'string' || typeof entry.algorithm !== 'string' || typeof entry.digest !== 'string')) throw new TypeError('Context commitments must be a JSON array of namespace, algorithm and digest objects')
  return normalizeContextCommitments(value as ContextCommitment[])
}

export function buildExactCallIntent(input: ExactCallIntentInput): Intent {
  const transaction = input.transaction
  if (typeof transaction.chainId !== 'number' || !Number.isSafeInteger(transaction.chainId) || transaction.chainId < 1) throw new TypeError('transaction.chainId must be a positive JSON integer')
  const sender = address(transaction.from, 'transaction.from')
  const callTarget = address(transaction.to, 'transaction.to')
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(transaction.data)) throw new TypeError('transaction.data must be 0x-prefixed bytes')
  if (!Number.isSafeInteger(input.validUntil) || input.validUntil < 1) throw new TypeError('validUntil must be positive Unix seconds')
  return {
    schema: 'priorseal.intent.v2',
    executionProfile: 'priorseal.execution-profile.exact-call.v1',
    intentId: input.intentId,
    chainId: transaction.chainId,
    action: 'CONTRACT_CALL',
    asset: input.asset,
    amount: uintString(input.amount, 'amount'),
    sender,
    recipient: callTarget,
    validUntil: input.validUntil,
    nonce: uintString(transaction.nonce, 'transaction.nonce'),
    callTarget,
    calldataHash: keccak256(transaction.data),
    transactionValue: uintString(transaction.value ?? 0, 'transaction.value'),
    ...(input.contextCommitments ? { contextCommitments: normalizeContextCommitments(input.contextCommitments) } : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
  }
}

function normalizeContextCommitments(commitments: ContextCommitment[]): ContextCommitment[] {
  if (commitments.length < 1 || commitments.length > 16) throw new TypeError('contextCommitments must contain between 1 and 16 entries')
  const normalized = commitments.map((entry) => {
    if (!entry || typeof entry.namespace !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.namespace)) throw new TypeError('context commitment namespace is invalid')
    if (!['keccak256', 'sha256'].includes(entry.algorithm)) throw new TypeError('context commitment algorithm is invalid')
    if (typeof entry.digest !== 'string') throw new TypeError('context commitment digest must be 32-byte hex')
    const digest = entry.digest.toLowerCase()
    if (!/^0x[0-9a-f]{64}$/.test(digest)) throw new TypeError('context commitment digest must be 32-byte hex')
    return { namespace: entry.namespace, algorithm: entry.algorithm, digest }
  }).sort((left, right) => compareCommitmentKeys(left, right))
  if (new Set(normalized.map((entry) => `${entry.namespace}:${entry.algorithm}:${entry.digest}`)).size !== normalized.length) throw new TypeError('contextCommitments must not contain duplicates')
  return normalized
}

function compareCommitmentKeys(left: ContextCommitment, right: ContextCommitment) {
  const leftKey = `${left.namespace}:${left.algorithm}:${left.digest}`
  const rightKey = `${right.namespace}:${right.algorithm}:${right.digest}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

function address(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError(`${field} must be a 20-byte EVM address`)
  return value.toLowerCase()
}

function uintString(value: bigint | number | string, field: string) {
  try {
    if (!['bigint', 'number', 'string'].includes(typeof value)) throw new Error()
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error()
    const result = BigInt(value)
    if (result < 0n) throw new Error()
    return result.toString(10)
  } catch {
    throw new TypeError(`${field} must be an unsigned integer`)
  }
}
