import test from 'node:test'
import assert from 'node:assert/strict'

import { matchContextCommitment } from '../../sdk/dist/index.js'

const insight = {
  namespace: 'insight.pretrade-pair.v1',
  algorithm: 'keccak256',
  digest: `0x${'a'.repeat(64)}`,
}

test('matches a namespaced external assessment without interpreting its semantics', () => {
  const result = matchContextCommitment(
    { contextCommitments: [insight] },
    { ...insight, digest: insight.digest.toUpperCase().replace('0X', '0x') },
  )
  assert.deepEqual(result, { matched: true, code: 'OK', commitment: insight })
})

test('distinguishes missing, algorithm, and digest mismatches', () => {
  assert.equal(
    matchContextCommitment({ contextCommitments: [] }, insight).code,
    'CONTEXT_COMMITMENT_MISSING',
  )
  assert.equal(
    matchContextCommitment(
      { contextCommitments: [{ ...insight, algorithm: 'sha256' }] },
      insight,
    ).code,
    'CONTEXT_COMMITMENT_ALGORITHM_MISMATCH',
  )
  assert.equal(
    matchContextCommitment(
      { contextCommitments: [{ ...insight, digest: `0x${'b'.repeat(64)}` }] },
      insight,
    ).code,
    'CONTEXT_COMMITMENT_DIGEST_MISMATCH',
  )
})
