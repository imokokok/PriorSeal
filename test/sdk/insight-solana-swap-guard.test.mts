import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'

import {
  buildSolanaSwapGuardBoundIntent,
  detectSolanaSwapGuardSettlementContradictions,
  encodeSolanaTransactionMessageBytes,
  hashSolanaTransactionMessage,
  verifyInsightSolanaSwapGuardDecision,
  verifyInsightSolanaSwapGuardSettlement,
  verifySolanaSwapGuardSettlementForDecision,
} from '../../sdk/dist/index.js'

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const PROFILE = 'solana-orca-whirlpool-usdc-usdt-1'

function base58(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes) value = value * 256n + BigInt(byte)
  let output = ''
  while (value > 0n) { output = BASE58[Number(value % 58n)] + output; value /= 58n }
  for (const byte of bytes) { if (byte !== 0) break; output = `1${output}` }
  return output || '1'
}

function key(seed: number): string {
  return base58(Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 255 + 1))
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((name) => `${JSON.stringify(name)}:${canonical(object[name])}`).join(',')}}`
}

function sha256(value: unknown): `0x${string}` {
  return `0x${createHash('sha256').update(canonical(value)).digest('hex')}`
}

const now = 1_792_252_800

// Real fee-payer keypair so the executed-message binding can be exercised.
const payerKeypair = generateKeyPairSync('ed25519')
const payerJwk = payerKeypair.publicKey.export({ format: 'jwk' })
if (!payerJwk.x) throw new Error('Ed25519 public key export failed')
const payer = base58(Buffer.from(payerJwk.x, 'base64url'))

const transaction = {
  network: 'mainnet-beta' as const,
  messageVersion: 'legacy' as const,
  feePayer: payer,
  recentBlockhash: key(20),
  header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
  accountKeys: [payer, key(2)],
  addressTableLookups: [],
  loadedAddresses: { writable: [], readonly: [] },
  instructions: [{ programIdIndex: 1, accountIndexes: [0], data: '' }],
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicJwk = publicKey.export({ format: 'jwk' })
if (!publicJwk.x) throw new Error('Ed25519 public key export failed')
const attester = base58(Buffer.from(publicJwk.x, 'base64url'))

async function decision(direction: 'usdc-to-usdt' | 'usdt-to-usdc' = 'usdc-to-usdt') {
  const messageHash = await hashSolanaTransactionMessage(transaction)
  const action = {
    profileId: PROFILE,
    direction,
    programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
    instructionDataHash: `0x${'12'.repeat(32)}` as const,
    messageHash,
    amount: '1000000',
    account: payer,
  }
  const guard = {
    schema: 'insight.solana-swap-guard.v1' as const,
    verdict: 'ALLOW' as const,
    profileId: PROFILE,
    direction,
    market: { exactSwap: { amountInRaw: '1000000', minOutRaw: '900000' } },
    exactAction: action,
  }
  const decisionHash = sha256({ schema: 'insight.solana-swap-guard-decision.v1', guard, transaction, action })
  const payload = {
    decisionHash,
    messageHash,
    account: payer,
    profileId: PROFILE,
    direction,
    verdict: 0 as const,
    issuedAt: now,
    validUntil: now + 300,
    schemaVersion: 1 as const,
  }
  const signer = { algorithm: 'ed25519' as const, publicKey: attester }
  const signature = base58(sign(null, Buffer.from(canonical({ schema: 'insight.solana-swap-guard-decision.v1', payload, signer })), privateKey))
  return { schema: 'insight.solana-swap-guard-decision.v1' as const, guard, transaction, action, decisionHash, attestation: { schema: 'insight.solana-swap-guard-decision.v1' as const, payload, signer, signature } }
}

/** The on-chain fee-payer signature over the exact reviewed message bytes. */
function txSignature(keypair: import('node:crypto').KeyObject = payerKeypair.privateKey): string {
  return base58(sign(null, Buffer.from(encodeSolanaTransactionMessageBytes(transaction)), keypair))
}

async function settlement(decisionHash: string, txSig: string) {
  const payload = {
    decisionHash,
    signature: txSig,
    taker: payer,
    profileId: PROFILE,
    direction: 'usdc-to-usdt' as const,
    amountInRaw: '1000000',
    minOutRaw: '900000',
    sourceAmountRaw: '1000000',
    destinationAmountRaw: '998512',
    status: 'SETTLED' as const,
    reconciliation: 'OK',
    slot: 310000000,
    executedAt: now + 5,
    issuedAt: now + 20,
    schemaVersion: 1 as const,
  }
  const signer = { algorithm: 'ed25519' as const, publicKey: attester }
  const signature = base58(sign(null, Buffer.from(canonical({ schema: 'insight.solana-swap-guard-settlement.v1', payload, signer })), privateKey))
  return { schema: 'insight.solana-swap-guard-settlement.v1' as const, payload, signer, signature }
}

test('verifies the Ed25519 swap decision and binds exactly one reviewed message', async () => {
  const proof = await decision()
  const verification = await verifyInsightSolanaSwapGuardDecision(proof, { trustedPublicKey: attester, now })
  assert.equal(verification.valid, true)
  const intent = await buildSolanaSwapGuardBoundIntent({
    intentId: 'solana-swap-test',
    asset: `${SOLANA_MAINNET}/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
    amount: '1000000',
    validUntil: now + 500,
    transaction,
  }, proof, { trustedPublicKey: attester, now })
  assert.equal(intent.validUntil, now + 300)
  assert.equal(intent.sender, payer)
  assert.deepEqual(intent.contextCommitments, [{ namespace: 'insight.solana-swap-guard.v1', algorithm: 'sha256', digest: proof.decisionHash }])
})

test('closes the loop: settlement verifies, cross-binds, and proves executed == reviewed', async () => {
  const proof = await decision()
  const closure = await settlement(proof.decisionHash, txSignature())
  assert.equal((await verifyInsightSolanaSwapGuardSettlement(closure, { trustedPublicKey: attester })).valid, true)
  const cross = await verifySolanaSwapGuardSettlementForDecision({ settlement: closure, decision: proof }, { trustedPublicKey: attester })
  assert.deepEqual(cross, { valid: true, reason: 'OK', settlement: closure.payload, attester: attester })
})

test('rejects a settlement whose transaction is not the reviewed message', async () => {
  const proof = await decision()
  const stranger = generateKeyPairSync('ed25519').privateKey
  const closure = await settlement(proof.decisionHash, txSignature(stranger))
  const cross = await verifySolanaSwapGuardSettlementForDecision({ settlement: closure, decision: proof }, { trustedPublicKey: attester })
  assert.equal(cross.valid, false)
  assert.equal(cross.reason, 'EXECUTED_MESSAGE_MISMATCH')
})

test('rejects a settlement cross-binding whose decision attester is not the pinned key', async () => {
  const proof = await decision()
  const stranger = generateKeyPairSync('ed25519')
  const strangerJwk = stranger.publicKey.export({ format: 'jwk' })
  if (!strangerJwk.x) throw new Error('Ed25519 public key export failed')
  proof.attestation.signer.publicKey = base58(Buffer.from(strangerJwk.x, 'base64url'))
  const closure = await settlement(proof.decisionHash, txSignature())
  const cross = await verifySolanaSwapGuardSettlementForDecision({ settlement: closure, decision: proof }, { trustedPublicKey: attester })
  assert.equal(cross.valid, false)
  assert.equal(cross.reason, 'DECISION_UNTRUSTED_ATTESTER')
  assert.equal(cross.settlement, null)
})

test('flags two closures of one decision claiming different executed transactions', async () => {
  const proof = await decision()
  const first = await settlement(proof.decisionHash, txSignature())
  const stranger = generateKeyPairSync('ed25519').privateKey
  const second = await settlement(proof.decisionHash, txSignature(stranger))
  const report = await detectSolanaSwapGuardSettlementContradictions([first, second], { trustedPublicKey: attester })
  assert.equal(report.verified, 2)
  assert.equal(report.consistent, false)
  assert.equal(report.contradictions.length, 1)
  assert.equal(report.contradictions[0].decisionHash, proof.decisionHash)
  assert.equal(report.contradictions[0].txSignatures.length, 2)
})

test('rejects a tampered Solana message before authorization preparation', async () => {
  const proof = await decision()
  proof.transaction.instructions[0].data = '1'
  await assert.rejects(buildSolanaSwapGuardBoundIntent({
    intentId: 'solana-swap-test',
    asset: `${SOLANA_MAINNET}/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
    amount: '1000000',
    validUntil: now + 100,
    transaction,
  }, proof, { trustedPublicKey: attester, now }))
})
