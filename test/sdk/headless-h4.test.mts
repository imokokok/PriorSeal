import test from 'node:test'
import assert from 'node:assert/strict'

import { keccak256 } from 'viem'

import {
  HEADLESS_H4_ENTRY_HASH_NAMESPACE,
  buildHeadlessH4ExactCallIntent,
  headlessH4EntryHashCommitment,
  parseHeadlessH4EntryHash,
} from '../../sdk/dist/index.js'

const entryHash = `sha256:${'a'.repeat(64)}`
const rawEntryHash = `0x${'a'.repeat(64)}`
const transaction = {
  chainId: 8453,
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  data: `0x12345678${'00'.repeat(32)}${'a'.repeat(64)}` as `0x${string}`,
  nonce: '7',
  value: '0',
}

const otherCommitment = {
  namespace: 'example.review.v1',
  algorithm: 'keccak256' as const,
  digest: `0x${'b'.repeat(64)}`,
}

test('builds a PriorSeal exact-call intent that binds the same H4 entry in calldata', () => {
  const intent = buildHeadlessH4ExactCallIntent({
    transaction,
    entryHash,
    intentId: 'headless-h4-test',
    asset: 'eip155:8453/native',
    amount: '0',
    validUntil: 1_800_000_000,
    contextCommitments: [otherCommitment],
  })

  assert.equal(intent.calldataHash, keccak256(transaction.data))
  assert.deepEqual(intent.contextCommitments, [otherCommitment, {
    namespace: HEADLESS_H4_ENTRY_HASH_NAMESPACE,
    algorithm: 'sha256',
    digest: rawEntryHash,
  }])
})

test('normalizes the checker wire value and refuses malformed or absent bindings', () => {
  assert.equal(parseHeadlessH4EntryHash(entryHash), entryHash)
  assert.deepEqual(headlessH4EntryHashCommitment(entryHash), {
    namespace: HEADLESS_H4_ENTRY_HASH_NAMESPACE,
    algorithm: 'sha256',
    digest: rawEntryHash,
  })
  assert.throws(() => parseHeadlessH4EntryHash(`sha256:${'A'.repeat(64)}`), /lowercase/)
  assert.throws(() => buildHeadlessH4ExactCallIntent({
    transaction: { ...transaction, data: `0x${'00'.repeat(64)}` },
    entryHash,
    intentId: 'headless-h4-missing',
    asset: 'eip155:8453/native',
    amount: '0',
    validUntil: 1_800_000_000,
  }), /must carry/)
})

test('rejects a conflicting or duplicated H4 commitment instead of silently choosing one', () => {
  const h4 = headlessH4EntryHashCommitment(entryHash)
  const input = {
    transaction,
    entryHash,
    intentId: 'headless-h4-conflict',
    asset: 'eip155:8453/native',
    amount: '0',
    validUntil: 1_800_000_000,
  }

  assert.throws(() => buildHeadlessH4ExactCallIntent({
    ...input,
    contextCommitments: [{ ...h4, digest: `0x${'c'.repeat(64)}` }],
  }), /conflicting/)
  assert.throws(() => buildHeadlessH4ExactCallIntent({
    ...input,
    contextCommitments: [h4, h4],
  }), /more than once/)
})
