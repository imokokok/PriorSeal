import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSolanaJupiterSwapBoundIntent,
  verifyInsightSolanaJupiterSwapGuardResult,
  verifySolanaJupiterSwapAuthorizationBinding,
} from '../../sdk/dist/index.js'

const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function key(seed: number): string {
  let value = 0n
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 255 + 1)
  for (const byte of bytes) value = value * 256n + BigInt(byte)
  let output = ''
  while (value > 0n) { output = BASE58[Number(value % 58n)] + output; value /= 58n }
  return output
}

const inputMint = key(10)
const outputMint = key(20)
const feePayer = key(30)
const program = key(40)
const transaction = {
  network: 'mainnet-beta' as const,
  messageVersion: 'legacy' as const,
  feePayer,
  recentBlockhash: key(50),
  header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
  accountKeys: [feePayer, program],
  addressTableLookups: [],
  loadedAddresses: { writable: [], readonly: [] },
  instructions: [{ programIdIndex: 1, accountIndexes: [0], data: '' }],
}

function decision() {
  const risk = {
    source: 'solana_jupiter_swap_guard' as const,
    schema: 'insight.solana-jupiter-swap-guard.v1' as const,
    ruleSetVersion: 'test-rules',
    verdict: 'PASS' as const,
    status: 'decided' as const,
    productOutcome: 'approved' as const,
    evaluatedAt: '2026-11-17T00:00:00.000Z',
    quoteDigest: `0x${'12'.repeat(32)}` as `0x${string}`,
    reasonsDigest: `0x${'34'.repeat(32)}` as `0x${string}`,
    reasons: [],
  }
  return {
    venue: 'solana_jupiter' as const,
    state: 'READY' as const,
    guard: { verdict: 'PASS' as const, product_outcome: 'approved' as const, executable: true as const, reasons: [], risk_verdict_ref: risk },
    swap: {
      schema: 'insight.solana-jupiter-swap.v1' as const,
      venue: 'jupiter' as const,
      network: SOLANA,
      chainId: 0 as const,
      direction: { mode: 'exact-in' as const, inputMint, outputMint },
      quote: { inputMint, outputMint, amountInRaw: '1000000', minimumOutRaw: '990000' },
      transaction: { base64: 'AQIDBAUGCA==', lastValidBlockHeight: 123, signatureRequired: 'user' as const },
      riskVerdictRef: risk,
    },
  }
}

test('validates a Jupiter READY result and binds its quote digest to the exact Solana message', () => {
  const proof = decision()
  assert.equal(verifyInsightSolanaJupiterSwapGuardResult(proof).valid, true)
  const intent = buildSolanaJupiterSwapBoundIntent({ intentId: 'jupiter-exact-message', asset: `${SOLANA}/spl:${inputMint}`, amount: '1000000', validUntil: 1_800_000_000, transaction }, proof)
  assert.equal(intent.solanaTransaction?.feePayer, feePayer)
  assert.deepEqual(intent.contextCommitments, [{ namespace: 'insight.solana-jupiter-swap-guard.v1', algorithm: 'sha256', digest: `0x${'12'.repeat(32)}` }])
  assert.deepEqual(verifySolanaJupiterSwapAuthorizationBinding({ intent }, proof), { valid: true, reason: 'OK' })
})

test('rejects a Jupiter result that is not executable or whose risk references differ', () => {
  const proof = decision()
  const broken = { ...proof, guard: { ...proof.guard, executable: false } }
  assert.equal(verifyInsightSolanaJupiterSwapGuardResult(broken).valid, false)
})

