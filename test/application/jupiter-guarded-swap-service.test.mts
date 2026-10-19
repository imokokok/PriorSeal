import assert from 'node:assert/strict'
import test from 'node:test'

import { Keypair, VersionedTransaction } from '@solana/web3.js'
import { JupiterGuardedSwapError } from '../../sdk/dist/index.js'
import { createGuardedJupiterSwapService, createJupiterV0Compiler, type GuardedJupiterAuthorizationRecord } from '../../src/application/jupiter/guarded-swap-service.mjs'

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'
const authorizationId = 'jupiter-authorization-1'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const byte of bytes) integer = (integer << 8n) | BigInt(byte)
  let value = ''
  while (integer > 0n) { value = alphabet[Number(integer % 58n)]! + value; integer /= 58n }
  let leadingZeroes = 0
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1
  return '1'.repeat(leadingZeroes) + value
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

test('guarded Jupiter relay requires and atomically consumes the exact accepted authorization', async () => {
  const payer = await Keypair.generate()
  const payerAddress = payer.publicKey.toBase58()
  let sent = 0
  let record: GuardedJupiterAuthorizationRecord | undefined
  const connection = {
    async getLatestBlockhash() { return { blockhash: payerAddress as never, lastValidBlockHeight: 1n } },
    async getAddressLookupTable() { throw new Error('No address lookup table is expected') },
    async sendRawTransaction(bytes: Uint8Array) {
      sent += 1
      return base58(VersionedTransaction.deserialize(bytes).signatures[0]!)
    },
  }
  const service = createGuardedJupiterSwapService({
    jupiterApiKey: 'jupiter-test-key',
    insightApiKey: 'insight-test-key',
    rpcUrl: 'https://rpc.test',
    jupiterBaseUrl: 'https://jupiter.test/swap/v2/build',
    insightBaseUrl: 'https://insight.test',
    policy: { maxInputAmountAtomic: '2000000', maxSlippageBps: 50, allowedProgramIds: [TOKEN_PROGRAM], authorizationTtlSeconds: 60 },
    compiler: createJupiterV0Compiler({ rpcUrl: 'https://rpc.test', connection: connection as never }),
    connection: connection as never,
    now: () => 1_800_000_000_000,
    authorizationStore: {
      async getAuthorization(id: string) { return id === authorizationId ? record : undefined },
      async claimAuthorization(id: string, txHash: string) {
        if (id !== authorizationId || !record) return { ok: false, code: 'AUTHORIZATION_NOT_FOUND' }
        if (record.boundTxHash || record.uses !== 0 || record.status !== 'ACCEPTED') return { ok: false, code: 'AUTHORIZATION_ALREADY_USED' }
        record = { ...record, boundTxHash: txHash, uses: 1, status: 'BOUND' }
        return { ok: true, record }
      },
    },
    fetch: async (url, init) => {
      if (String(url).startsWith('https://jupiter.test/')) return json({
        inputMint: USDC, outputMint: WRAPPED_SOL, inAmount: '1000000', otherAmountThreshold: '990000', swapMode: 'ExactIn', slippageBps: 50,
        computeBudgetInstructions: [], setupInstructions: [], swapInstruction: { programId: TOKEN_PROGRAM, accounts: [], data: 'AA==' }, cleanupInstruction: null, otherInstructions: [], tipInstruction: null,
        addressesByLookupTableAddress: null,
      })
      const request = JSON.parse(String(init?.body)) as { expectedMessageHash: string }
      return json({ data: { receipt: { schema: 'insight.solana-simulation-receipt.v1', payload: { simulation: { messageHash: request.expectedMessageHash, signatureState: 'UNSIGNED', status: 'SIMULATED' } } }, contextCommitment: { namespace: 'insight.solana-simulation-receipt.v1', algorithm: 'sha256', digest: `0x${'a'.repeat(64)}` } } })
    },
  })

  const prepared = (await service.prepare({ inputMint: USDC, outputMint: WRAPPED_SOL, amount: '1000000', taker: payerAddress, slippageBps: 50, intentId: 'jupiter-relay-test-1' })).prepared
  const signed = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(prepared.transactionBase64, 'base64')))
  await signed.sign([payer])
  const signedTransactionBase64 = Buffer.from(signed.serialize()).toString('base64')

  await assert.rejects(
    service.submit({ authorizationId, prepared, signedTransactionBase64 }),
    (error) => error instanceof JupiterGuardedSwapError && error.code === 'AUTHORIZATION_NOT_FOUND',
  )
  assert.equal(sent, 0)

  const altered = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(prepared.transactionBase64, 'base64')))
  altered.message.recentBlockhash = (await Keypair.generate()).publicKey.toBase58() as never
  const tampered = structuredClone(prepared)
  tampered.transactionBase64 = Buffer.from(altered.serialize()).toString('base64')
  tampered.transactionDigest = await sha256(altered.serialize())
  await assert.rejects(
    service.submit({ authorizationId, prepared: tampered, signedTransactionBase64 }),
    (error) => error instanceof JupiterGuardedSwapError && error.code === 'PREPARED_WIRE_MESSAGE_MISMATCH',
  )
  assert.equal(sent, 0)

  record = {
    authorization: {
      authorizationId,
      intentHash: prepared.intent.intentHash,
      intent: prepared.intent,
      authorizer: { type: 'solana-ed25519', address: payerAddress },
      principal: { account: payerAddress },
      delegate: { executor: payerAddress },
      notBefore: 1_799_999_999,
      expiresAt: prepared.intent.validUntil,
    },
    acceptance: { status: 'ACCEPTED', authorizationId, intentHash: prepared.intent.intentHash },
    boundTxHash: null,
    uses: 0,
    status: 'ACCEPTED',
  } as unknown as GuardedJupiterAuthorizationRecord
  const result = await service.submit({ authorizationId, prepared, signedTransactionBase64 })
  assert.equal(result.submission, 'SUBMITTED')
  assert.equal(sent, 1)
  assert.equal(record.boundTxHash, result.signature)

  await assert.rejects(
    service.submit({ authorizationId, prepared, signedTransactionBase64 }),
    (error) => error instanceof JupiterGuardedSwapError && error.code === 'AUTHORIZATION_ALREADY_USED',
  )
  assert.equal(sent, 1)
})
