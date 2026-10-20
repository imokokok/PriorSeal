import assert from 'node:assert/strict'
import test from 'node:test'

import { Keypair, VersionedTransaction } from '@solana/web3.js'
import { SOLANA_COMPUTE_BUDGET_PROGRAM, ZeroExGuardedSwapError } from '../../sdk/dist/index.js'
import { createGuardedZeroExSwapService, type GuardedZeroExAuthorizationRecord } from '../../src/application/zeroex/guarded-swap-service.mjs'
import { createJupiterV0Compiler } from '../../src/application/jupiter/guarded-swap-service.mjs'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'
const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111'
const authorizationId = 'zeroex-authorization-1'

function json(body: unknown): Response { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }) }

async function signingMaterial() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey
  return {
    privateKey: pair.privateKey,
    configuration: { trustedKeys: [{ kty: 'OKP' as const, crv: 'Ed25519' as const, kid: '0x-test-signing-key', x: publicKey.x! }] },
  }
}

async function signedZeroExJson(body: unknown, input: { url: string; requestBody: string; privateKey: CryptoKey }): Promise<Response> {
  const responseBody = JSON.stringify(body)
  const responseDigest = await digest(responseBody)
  const requestDigest = await digest(input.requestBody)
  const signatureInput = 'sig=("@status" "content-type" "content-digest" "@method";req "@authority";req "@path";req "@query";req "content-digest";req);created=1800000000;keyid="0x-test-signing-key";alg="ed25519";tag="0x-swap-api"'
  const parsed = new URL(input.url)
  const signatureBase = [
    '"@status": 200', '"content-type": application/json', `"content-digest": ${responseDigest}`,
    '"@method";req: post', `"@authority";req: ${parsed.host}`, `"@path";req: ${parsed.pathname}`, `"@query";req: ${parsed.search}`,
    `"content-digest";req: ${requestDigest}`, `"@signature-params": ${signatureInput.slice('sig='.length)}`,
  ].join('\n')
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, input.privateKey, new TextEncoder().encode(signatureBase)))
  return new Response(responseBody, { status: 200, headers: { 'content-type': 'application/json', 'content-digest': responseDigest, 'signature-input': signatureInput, signature: `sig=:${Buffer.from(signature).toString('base64')}:` } })
}

async function digest(value: string): Promise<string> {
  return `sha-256=:${Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('base64')}:`
}

function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const byte of bytes) integer = (integer << 8n) | BigInt(byte)
  let output = ''
  while (integer > 0n) { output = alphabet[Number(integer % 58n)]! + output; integer /= 58n }
  let leadingZeroes = 0
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1
  return '1'.repeat(leadingZeroes) + output
}

test('guarded 0x relay consumes only the exact authorization bound to the wallet-signed message', async () => {
  const payer = await Keypair.generate()
  const payerAddress = payer.publicKey.toBase58()
  const signing = await signingMaterial()
  let sent = 0
  let record: GuardedZeroExAuthorizationRecord | undefined
  const connection = {
    async getLatestBlockhash() { return { blockhash: payerAddress as never, lastValidBlockHeight: 1n } },
    async getAddressLookupTable() { throw new Error('No address lookup table is expected') },
    async sendRawTransaction(bytes: Uint8Array) { sent += 1; return base58(VersionedTransaction.deserialize(bytes).signatures[0]!) },
  }
  const service = createGuardedZeroExSwapService({
    zeroExApiKey: '0x-test-key', insightApiKey: 'insight-test-key', rpcUrl: 'https://rpc.test',
    zeroExBaseUrl: 'https://0x.test/solana/swap-instructions', insightBaseUrl: 'https://insight.test',
    responseSignature: signing.configuration,
    policy: { maxInputAmountAtomic: '2000000', maxSlippageBps: 50, allowedProgramIds: [SOLANA_COMPUTE_BUDGET_PROGRAM, SOLANA_SYSTEM_PROGRAM], computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100', maxComputeUnitLimit: 200_000, maxComputeUnitPriceMicroLamports: '100', maxPriorityFeeLamports: '20', authorizationTtlSeconds: 60 },
    compiler: createJupiterV0Compiler({ rpcUrl: 'https://rpc.test', connection: connection as never }), connection: connection as never,
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
      if (String(url).startsWith('https://0x.test/')) return signedZeroExJson({ amount_out: 1_000_000, min_amount_out: 990_000, instructions: [{ program_id: Array(32).fill(0), accounts: [], data: [0] }], address_lookup_tables: [], route_plan: [], zid: 'a'.repeat(24) }, { url: String(url), requestBody: String(init?.body), privateKey: signing.privateKey })
      const simulationRequest = JSON.parse(String(init?.body)) as { expectedMessageHash: string }
      return json({ data: { receipt: { schema: 'insight.solana-simulation-receipt.v1', payload: { simulation: { messageHash: simulationRequest.expectedMessageHash, signatureState: 'UNSIGNED', status: 'SIMULATED' } } }, contextCommitment: { namespace: 'insight.solana-simulation-receipt.v1', algorithm: 'sha256', digest: `0x${'a'.repeat(64)}` } } })
    },
  })

  const prepared = (await service.prepare({ inputMint: USDC, outputMint: WRAPPED_SOL, amount: '1000000', taker: payerAddress, slippageBps: 50, intentId: 'zeroex-relay-test-1' })).prepared
  const signed = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(prepared.transactionBase64, 'base64')))
  await signed.sign([payer])
  const signedTransactionBase64 = Buffer.from(signed.serialize()).toString('base64')
  await assert.rejects(service.submit({ authorizationId, prepared, signedTransactionBase64 }), (error) => error instanceof ZeroExGuardedSwapError && error.code === 'AUTHORIZATION_NOT_FOUND')
  assert.equal(sent, 0)

  record = {
    authorization: { authorizationId, intentHash: prepared.intent.intentHash, intent: prepared.intent, authorizer: { type: 'solana-ed25519', address: payerAddress }, principal: { account: payerAddress }, delegate: { executor: payerAddress }, notBefore: 1_799_999_999, expiresAt: prepared.intent.validUntil },
    acceptance: { status: 'ACCEPTED', authorizationId, intentHash: prepared.intent.intentHash }, boundTxHash: null, uses: 0, status: 'ACCEPTED',
  } as unknown as GuardedZeroExAuthorizationRecord
  const result = await service.submit({ authorizationId, prepared, signedTransactionBase64 })
  assert.equal(result.submission, 'SUBMITTED')
  assert.equal(sent, 1)
  assert.equal(record.boundTxHash, result.signature)
})

test('guarded 0x verifies a tenant fee recipient before forwarding server-owned commercial terms', async () => {
  const payer = await Keypair.generate()
  const payerAddress = payer.publicKey.toBase58()
  const signing = await signingMaterial()
  let feeAccountReads = 0
  let zeroExRequest: Record<string, unknown> | undefined
  const connection = {
    async getLatestBlockhash() { return { blockhash: payerAddress as never, lastValidBlockHeight: 1n } },
    async getAddressLookupTable() { throw new Error('No address lookup table is expected') },
    async getParsedAccountInfo() { feeAccountReads += 1; return { value: { data: { parsed: { type: 'account', info: { mint: USDC } } } } } },
    async sendRawTransaction() { throw new Error('submission is not expected') },
  }
  const service = createGuardedZeroExSwapService({
    zeroExApiKey: '0x-test-key', insightApiKey: 'insight-test-key', rpcUrl: 'https://rpc.test',
    zeroExBaseUrl: 'https://0x.test/solana/swap-instructions', insightBaseUrl: 'https://insight.test', responseSignature: signing.configuration,
    policy: { maxInputAmountAtomic: '2000000', maxSlippageBps: 50, allowedInputMints: [USDC], allowedProgramIds: [SOLANA_COMPUTE_BUDGET_PROGRAM, SOLANA_SYSTEM_PROGRAM], computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100', maxComputeUnitLimit: 200_000, maxComputeUnitPriceMicroLamports: '100', maxPriorityFeeLamports: '20', authorizationTtlSeconds: 60 },
    tenantPolicies: { schema: 'priorseal.zeroex-tenant-policy-set.v1', defaultTenantId: 'public', tenants: [{ tenantId: 'public', commercialFee: { profileId: 'public-usdc-10bps', inputMint: USDC, feePpm: 1_000, recipientTokenAccount: USDC, side: 'sell' } }] },
    compiler: createJupiterV0Compiler({ rpcUrl: 'https://rpc.test', connection: connection as never }), connection: connection as never,
    now: () => 1_800_000_000_000,
    authorizationStore: { async getAuthorization() { return undefined }, async claimAuthorization() { return { ok: false } } },
    fetch: async (url, init) => {
      if (String(url).startsWith('https://0x.test/')) {
        zeroExRequest = JSON.parse(String(init?.body)) as Record<string, unknown>
        return signedZeroExJson({ amount_out: 1_000_000, min_amount_out: 990_000, instructions: [{ program_id: Array(32).fill(0), accounts: [], data: [0] }], address_lookup_tables: [], route_plan: [], zid: 'a'.repeat(24) }, { url: String(url), requestBody: String(init?.body), privateKey: signing.privateKey })
      }
      const simulationRequest = JSON.parse(String(init?.body)) as { expectedMessageHash: string }
      return json({ data: { receipt: { schema: 'insight.solana-simulation-receipt.v1', payload: { simulation: { messageHash: simulationRequest.expectedMessageHash, signatureState: 'UNSIGNED', status: 'SIMULATED' } } }, contextCommitment: { namespace: 'insight.solana-simulation-receipt.v1', algorithm: 'sha256', digest: `0x${'b'.repeat(64)}` } } })
    },
  })
  const result = await service.prepare({ inputMint: USDC, outputMint: WRAPPED_SOL, amount: '1000000', taker: payerAddress, slippageBps: 50 })
  assert.equal(result.tenantId, 'public')
  assert.equal(feeAccountReads, 1)
  assert.deepEqual({ ppm: zeroExRequest?.swap_fee_ppm, recipient: zeroExRequest?.swap_fee_recipient, side: zeroExRequest?.swap_fee_side }, { ppm: 1_000, recipient: USDC, side: 'sell' })
  assert.equal(result.review.commercial.fee?.expectedAmountAtomic, '1000')
})
