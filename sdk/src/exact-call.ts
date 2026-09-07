import { keccak256 } from 'viem'
import type { ContextCommitment, ExactCallIntentInput, Intent } from './types.js'

export function buildExactCallIntent(input: ExactCallIntentInput): Intent {
  const transaction = input.transaction
  if (!Number.isSafeInteger(Number(transaction.chainId)) || Number(transaction.chainId) < 1) throw new TypeError('transaction.chainId must be a positive integer')
  const sender = address(transaction.from, 'transaction.from')
  const callTarget = address(transaction.to, 'transaction.to')
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(transaction.data)) throw new TypeError('transaction.data must be 0x-prefixed bytes')
  if (!Number.isSafeInteger(input.validUntil) || input.validUntil < 1) throw new TypeError('validUntil must be positive Unix seconds')
  return {
    schema: 'priorseal.intent.v2',
    executionProfile: 'priorseal.execution-profile.exact-call.v1',
    intentId: input.intentId,
    chainId: Number(transaction.chainId),
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
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.namespace)) throw new TypeError('context commitment namespace is invalid')
    if (!['keccak256', 'sha256'].includes(entry.algorithm)) throw new TypeError('context commitment algorithm is invalid')
    const digest = String(entry.digest).toLowerCase()
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

function address(value: string, field: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError(`${field} must be a 20-byte EVM address`)
  return value.toLowerCase()
}

function uintString(value: bigint | number | string, field: string) {
  try {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error()
    const result = BigInt(value)
    if (result < 0n) throw new Error()
    return result.toString(10)
  } catch {
    throw new TypeError(`${field} must be an unsigned integer`)
  }
}
