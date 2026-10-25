import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'

import {
  buildSolanaLendingGuardBoundIntent,
  verifyInsightSolanaLendingGuardDecision,
} from '../../sdk/dist/index.js'

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes) value = value * 256n + BigInt(byte)
  let output = ''
  while (value > 0n) { output = BASE58[Number(value % 58n)] + output; value /= 58n }
  for (const byte of bytes) { if (byte !== 0) break; output = `1${output}` }
  return output || '1'
}
function key(seed: number): string { return base58(Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 255 + 1)) }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((name) => `${JSON.stringify(name)}:${canonical(object[name])}`).join(',')}}`
}
async function sha256(value: unknown): Promise<`0x${string}`> {
  return `0x${createHash('sha256').update(canonical(value)).digest('hex')}`
}

const now = 1_792_252_800
const payer = key(1)
const transaction = {
  network: 'mainnet-beta' as const, messageVersion: 'legacy' as const, feePayer: payer, recentBlockhash: key(20),
  header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
  accountKeys: [payer, key(2)], addressTableLookups: [], loadedAddresses: { writable: [], readonly: [] },
  instructions: [{ programIdIndex: 1, accountIndexes: [0], data: '' }],
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicJwk = publicKey.export({ format: 'jwk' })
if (!publicJwk.x) throw new Error('Ed25519 public key export failed')
const attester = base58(Buffer.from(publicJwk.x, 'base64url'))

async function decision() {
  const messageHash = await (await import('../../sdk/dist/index.js')).hashSolanaTransactionMessage(transaction)
  const action = {
    protocolId: 'kamino-lend' as const, action: 'supply' as const,
    programId: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', instructionDataHash: `0x${'12'.repeat(32)}` as const,
    messageHash, amount: '1000000', account: payer, marketId: key(3), reserveOrBank: key(4), positionAccount: null, assetMint: 'So11111111111111111111111111111111111111112',
  }
  const guard = {
    schema: 'insight.solana-lending-guard.v1' as const, verdict: 'ALLOW' as const, chainId: 0 as const,
    chainRef: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const, protocolId: 'kamino-lend' as const, action: 'supply' as const,
    market: { collateralSymbol: 'SOL', loanSymbol: 'USDC' }, exactAction: action,
  }
  const decisionHash = await sha256({ schema: 'insight.solana-lending-guard-decision.v1', guard, transaction, action })
  const payload = { decisionHash, messageHash, account: payer, protocolId: 'kamino-lend' as const, action: 'supply' as const, verdict: 0 as const, issuedAt: now, validUntil: now + 300, schemaVersion: 1 as const }
  const signer = { algorithm: 'ed25519' as const, publicKey: attester }
  const signature = base58(sign(null, Buffer.from(canonical({ schema: 'insight.solana-lending-guard-decision.v1', payload, signer })), privateKey))
  return { schema: 'insight.solana-lending-guard-decision.v1' as const, guard, transaction, action, decisionHash, attestation: { schema: 'insight.solana-lending-guard-decision.v1' as const, payload, signer, signature } }
}

test('verifies Insight Ed25519 evidence and binds precisely one Solana message', async () => {
  const proof = await decision()
  const verification = await verifyInsightSolanaLendingGuardDecision(proof, { trustedPublicKey: attester, now })
  assert.equal(verification.valid, true)
  const intent = await buildSolanaLendingGuardBoundIntent({
    intentId: 'solana-lending-test', asset: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501', amount: '1000000', validUntil: now + 500, transaction,
  }, proof, { trustedPublicKey: attester, now })
  assert.equal(intent.validUntil, now + 300)
  assert.equal(intent.sender, payer)
  assert.deepEqual(intent.contextCommitments, [{ namespace: 'insight.solana-lending-guard.v1', algorithm: 'sha256', digest: proof.decisionHash }])
})

test('rejects a tampered Solana message before authorization preparation', async () => {
  const proof = await decision()
  proof.transaction.instructions[0].data = '1'
  await assert.rejects(buildSolanaLendingGuardBoundIntent({
    intentId: 'solana-lending-test', asset: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501', amount: '1000000', validUntil: now + 100, transaction,
  }, proof, { trustedPublicKey: attester, now }))
})
