import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createZeroExRouterClient,
  prepareGuardedZeroExSwap,
  reviewGuardedZeroExSwap,
  SOLANA_COMPUTE_BUDGET_PROGRAM,
  ZeroExGuardedSwapError,
  type SolanaTransactionMessage,
} from '../../sdk/dist/index.js'

const WALLET = 'So11111111111111111111111111111111111111112'
const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function signingMaterial() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey
  return {
    privateKey: pair.privateKey,
    configuration: { trustedKeys: [{ kty: 'OKP' as const, crv: 'Ed25519' as const, kid: '0x-test-signing-key', x: publicKey.x! }] },
  }
}

async function signedJson(body: unknown, input: { url: string; requestBody: string; privateKey: CryptoKey; created?: number; status?: number; tamperBody?: unknown }): Promise<Response> {
  const status = input.status ?? 200
  const responseBody = JSON.stringify(input.tamperBody ?? body)
  const responseDigest = await digest(responseBody)
  const requestDigest = await digest(input.requestBody)
  const signatureInput = `sig=("@status" "content-type" "content-digest" "@method";req "@authority";req "@path";req "@query";req "content-digest";req);created=${input.created ?? 1_800_000_000};keyid="0x-test-signing-key";alg="ed25519";tag="0x-swap-api"`
  const parsed = new URL(input.url)
  const signatureBase = [
    `"@status": ${status}`,
    '"content-type": application/json',
    `"content-digest": ${responseDigest}`,
    '"@method";req: POST',
    `"@authority";req: ${parsed.host}`,
    `"@path";req: ${parsed.pathname}`,
    `"@query";req: ${parsed.search || '?'}`,
    `"content-digest";req: ${requestDigest}`,
    `"@signature-params": ${signatureInput.slice('sig='.length)}`,
  ].join('\n')
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, input.privateKey, new TextEncoder().encode(signatureBase)))
  return new Response(responseBody, { status, headers: { 'content-type': 'application/json', 'content-digest': responseDigest, 'signature-input': signatureInput, signature: `sig=:${Buffer.from(signature).toString('base64')}:` } })
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  return `sha-256=:${Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('base64')}:`
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

function computeLimit(limit: number): string {
  const data = new Uint8Array(5)
  data[0] = 2
  new DataView(data.buffer).setUint32(1, limit, true)
  return base58(data)
}

function computePrice(price: bigint): string {
  const data = new Uint8Array(9)
  data[0] = 3
  const view = new DataView(data.buffer)
  view.setUint32(1, Number(price & 0xffff_ffffn), true)
  view.setUint32(5, Number(price >> 32n), true)
  return base58(data)
}

function message(): SolanaTransactionMessage {
  return {
    network: 'mainnet-beta', messageVersion: 'v0', feePayer: WALLET, recentBlockhash: WALLET,
    header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 2 },
    accountKeys: [WALLET, SOLANA_COMPUTE_BUDGET_PROGRAM, SOLANA_SYSTEM_PROGRAM],
    addressTableLookups: [], loadedAddresses: { writable: [], readonly: [] },
    instructions: [
      { programIdIndex: 1, accountIndexes: [], data: computeLimit(200_000) },
      { programIdIndex: 1, accountIndexes: [], data: computePrice(100n) },
      { programIdIndex: 2, accountIndexes: [], data: '1' },
    ],
  }
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    amount_out: 1_000_000,
    min_amount_out: 990_000,
    instructions: [{ program_id: Array(32).fill(0), accounts: [], data: [0] }],
    address_lookup_tables: [],
    route_plan: [],
    zid: `0x${'a'.repeat(24)}`,
    ...overrides,
  }
}

function request() {
  return { intentId: 'zeroex-guard-test-1', inputMint: USDC, outputMint: WRAPPED_SOL, amount: '1000000', taker: WALLET, slippageBps: 50 }
}

function policy() {
  return {
    feePayer: WALLET,
    maxInputAmountAtomic: '2000000', maxSlippageBps: 50,
    allowedProgramIds: [SOLANA_COMPUTE_BUDGET_PROGRAM, SOLANA_SYSTEM_PROGRAM],
    computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100',
    maxComputeUnitLimit: 200_000, maxComputeUnitPriceMicroLamports: '100', maxPriorityFeeLamports: '20',
    authorizationTtlSeconds: 60,
  }
}

test('0x client keeps its API key in a header and produces a policy-bound raw instruction build', async () => {
  let endpoint = ''
  let requestBody: Record<string, unknown> | undefined
  const router = createZeroExRouterClient({
    apiKey: '0x-secret', computeBudget: { computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100' }, baseUrl: 'https://0x.test/solana/swap-instructions',
    fetch: async (url, init) => {
      endpoint = String(url)
      assert.equal(new Headers(init?.headers).get('0x-api-key'), '0x-secret')
      assert.equal(new Headers(init?.headers).get('0x-version'), 'v2')
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return json(response())
    },
  })
  const build = await router.build(request())
  assert.equal(endpoint, 'https://0x.test/solana/swap-instructions')
  assert.equal(requestBody?.transaction_version, 'v0')
  assert.equal(requestBody?.amount_in, 1_000_000)
  assert.doesNotMatch(endpoint, /0x-secret/)
  assert.equal(build.zeroExBuild.zid, 'a'.repeat(24))
  assert.deepEqual(build.zeroExBuild.computeBudgetInstructions.map((instruction) => instruction.programId), [SOLANA_COMPUTE_BUDGET_PROGRAM, SOLANA_COMPUTE_BUDGET_PROGRAM])
})

test('0x client requests and verifies a fresh response signature bound to its exact POST body', async () => {
  const signing = await signingMaterial()
  const endpoint = 'https://0x.test/solana/swap-instructions'
  const router = createZeroExRouterClient({
    apiKey: '0x-secret', computeBudget: { computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100' }, baseUrl: endpoint,
    responseSignature: signing.configuration, now: () => 1_800_000_000_000,
    fetch: async (url, init) => {
      assert.equal(new Headers(init?.headers).get('accept-signature'), 'sig=()')
      assert.equal(new Headers(init?.headers).get('content-digest'), await digest(String(init?.body)))
      return signedJson(response(), { url: String(url), requestBody: String(init?.body), privateKey: signing.privateKey })
    },
  })
  assert.equal((await router.build(request())).zeroExBuild.zid, 'a'.repeat(24))
})

test('0x client rejects stale or body-tampered signed responses', async () => {
  const signing = await signingMaterial()
  const endpoint = 'https://0x.test/solana/swap-instructions'
  const stale = createZeroExRouterClient({
    apiKey: '0x-secret', computeBudget: { computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100' }, baseUrl: endpoint,
    responseSignature: signing.configuration, now: () => 1_800_000_100_000,
    fetch: async (url, init) => signedJson(response(), { url: String(url), requestBody: String(init?.body), privateKey: signing.privateKey, created: 1_800_000_000 }),
  })
  await assert.rejects(stale.build(request()), (error) => error instanceof ZeroExGuardedSwapError && error.code === 'ZEROEX_RESPONSE_SIGNATURE_STALE')

  const tampered = createZeroExRouterClient({
    apiKey: '0x-secret', computeBudget: { computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100' }, baseUrl: endpoint,
    responseSignature: signing.configuration, now: () => 1_800_000_000_000,
    fetch: async (url, init) => {
      const signed = await signedJson(response(), { url: String(url), requestBody: String(init?.body), privateKey: signing.privateKey })
      return new Response(JSON.stringify(response({ amount_out: 1 })), { status: 200, headers: signed.headers })
    },
  })
  await assert.rejects(tampered.build(request()), (error) => error instanceof ZeroExGuardedSwapError && error.code === 'ZEROEX_RESPONSE_SIGNATURE_INVALID')
})

test('0x guarded preparation binds provider instructions, deployment compute controls, and Insight simulation', async () => {
  const router = createZeroExRouterClient({
    apiKey: '0x-secret', computeBudget: { computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100' },
    baseUrl: 'https://0x.test/solana/swap-instructions', fetch: async () => json(response()),
  })
  const prepared = await prepareGuardedZeroExSwap(request(), {
    router,
    compiler: { async compile() { return { transactionBase64: 'AA==', transaction: message() } } },
    insight: { async simulate(input: { expectedMessageHash: string }) { return { messageHash: input.expectedMessageHash, signatureState: 'UNSIGNED' as const, status: 'SIMULATED' as const, contextCommitment: { namespace: 'insight.solana-simulation-receipt.v1', algorithm: 'sha256' as const, digest: `0x${'b'.repeat(64)}` }, receipt: {} } } },
    policy: policy(), now: () => 1_800_000_000_000,
  })
  assert.equal(prepared.schema, 'priorseal.zeroex-guarded-swap.v1')
  assert.equal(prepared.build.minimumOutputAmount, '990000')
  const review = await reviewGuardedZeroExSwap(prepared, () => 1_800_000_010_000)
  assert.deepEqual(review.output, { mint: WRAPPED_SOL, minimumAmountAtomic: '990000', estimatedAmountAtomic: '1000000' })
  assert.equal(review.provider.zid, 'a'.repeat(24))
})

test('0x commercial fee is server-owned, transparent in review, and bound into the authorization intent', async () => {
  let requestBody: Record<string, unknown> | undefined
  const commercialFee = { profileId: 'retail-usdc-10bps', tenantId: 'retail', inputMint: USDC, feePpm: 1_000, recipientTokenAccount: USDC, side: 'sell' as const }
  const router = createZeroExRouterClient({
    apiKey: '0x-secret', computeBudget: { computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100' }, commercialFee,
    baseUrl: 'https://0x.test/solana/swap-instructions', fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return json(response())
    },
  })
  const prepared = await prepareGuardedZeroExSwap(request(), {
    router,
    compiler: { async compile() { return { transactionBase64: 'AA==', transaction: message() } } },
    insight: { async simulate(input: { expectedMessageHash: string }) { return { messageHash: input.expectedMessageHash, signatureState: 'UNSIGNED' as const, status: 'SIMULATED' as const, contextCommitment: { namespace: 'insight.solana-simulation-receipt.v1', algorithm: 'sha256' as const, digest: `0x${'b'.repeat(64)}` }, receipt: {} } } },
    policy: { ...policy(), commercialFee }, now: () => 1_800_000_000_000,
  })
  assert.deepEqual({ ppm: requestBody?.swap_fee_ppm, recipient: requestBody?.swap_fee_recipient, side: requestBody?.swap_fee_side }, { ppm: '1000', recipient: USDC, side: 'sell' })
  assert.deepEqual(prepared.commercial.fee, { profileId: 'retail-usdc-10bps', side: 'sell', mint: USDC, feePpm: 1_000, recipientTokenAccount: USDC, expectedAmountAtomic: '1000' })
  assert.ok(prepared.intent.contextCommitments?.some(commitment => commitment.namespace === 'priorseal.zeroex-commercial-record.v1' && commitment.digest === prepared.commercial.commitment.digest))
  assert.deepEqual((await reviewGuardedZeroExSwap(prepared)).commercial, prepared.commercial)
})

test('0x reserves the commercial evidence commitment namespace for server-generated terms', async () => {
  const router = createZeroExRouterClient({ apiKey: '0x-secret', computeBudget: { computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100' }, baseUrl: 'https://0x.test/solana/swap-instructions', fetch: async () => json(response()) })
  await assert.rejects(prepareGuardedZeroExSwap({ ...request(), contextCommitments: [{ namespace: 'priorseal.zeroex-commercial-record.v1', algorithm: 'sha256', digest: `0x${'c'.repeat(64)}` }] }, {
    router,
    compiler: { async compile() { return { transactionBase64: 'AA==', transaction: message() } } },
    insight: { async simulate() { throw new Error('simulation must not run') } },
    policy: policy(), now: () => 1_800_000_000_000,
  }), (error) => error instanceof ZeroExGuardedSwapError && error.code === 'ZEROEX_COMMERCIAL_COMMITMENT_RESERVED')
})

test('0x guarded client rejects sponsorship and unsafe input amounts before signing', async () => {
  const sponsored = createZeroExRouterClient({
    apiKey: '0x-secret', computeBudget: { computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100' }, baseUrl: 'https://0x.test/solana/swap-instructions', fetch: async () => json(response({ sponsor: {} })),
  })
  await assert.rejects(sponsored.build(request()), (error) => error instanceof ZeroExGuardedSwapError && error.code === 'ZEROEX_SPONSOR_FORBIDDEN')
  const safe = createZeroExRouterClient({
    apiKey: '0x-secret', computeBudget: { computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100' }, baseUrl: 'https://0x.test/solana/swap-instructions', fetch: async () => json(response()),
  })
  await assert.rejects(safe.build({ ...request(), amount: '9007199254740992' }), (error) => error instanceof ZeroExGuardedSwapError && error.code === 'ZEROEX_AMOUNT_UNSAFE')
})
