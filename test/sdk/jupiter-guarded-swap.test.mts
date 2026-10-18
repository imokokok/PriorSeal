import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createInsightSolanaSimulationClient,
  createJupiterRouterClient,
  assertPreparedGuardedJupiterSwap,
  JupiterGuardedSwapError,
  prepareGuardedJupiterSwap,
  reviewGuardedJupiterSwap,
  SOLANA_NATIVE_WRAPPED_MINT,
  type JupiterRouterBuild,
  type JupiterRouterBuildRequest,
  type SolanaTransactionMessage,
} from '../../sdk/dist/index.js'

const WALLET = '11111111111111111111111111111111'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function build(): JupiterRouterBuild {
  return {
    inputMint: USDC,
    outputMint: SOLANA_NATIVE_WRAPPED_MINT,
    inAmount: '1000000',
    otherAmountThreshold: '990000',
    swapMode: 'ExactIn',
    slippageBps: 50,
    computeBudgetInstructions: [],
    setupInstructions: [],
    swapInstruction: { programId: TOKEN_PROGRAM, accounts: [], data: 'AA==' },
    cleanupInstruction: null,
    otherInstructions: [],
    tipInstruction: null,
    addressLookupTableAddresses: [],
  }
}

function message(programId = TOKEN_PROGRAM, feePayer = WALLET): SolanaTransactionMessage {
  return {
    network: 'mainnet-beta',
    messageVersion: 'legacy',
    feePayer,
    recentBlockhash: WALLET,
    header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
    accountKeys: [feePayer, programId],
    addressTableLookups: [],
    loadedAddresses: { writable: [], readonly: [] },
    instructions: [{ programIdIndex: 1, accountIndexes: [], data: '1' }],
  }
}

function request(): JupiterRouterBuildRequest & { intentId: string } {
  return {
    inputMint: USDC,
    outputMint: SOLANA_NATIVE_WRAPPED_MINT,
    amount: '1000000',
    taker: WALLET,
    slippageBps: 50,
    intentId: 'jupiter-guard-test-1',
  }
}

function policy() {
  return {
    feePayer: WALLET,
    maxInputAmountAtomic: '2000000',
    maxSlippageBps: 50,
    allowedProgramIds: [TOKEN_PROGRAM],
    authorizationTtlSeconds: 60,
  }
}

test('prepares a self-paying Jupiter exact-in swap bound to Insight simulation evidence', async () => {
  const router = { async build() { return build() } }
  const compiler = { async compile() { return { transactionBase64: 'AA==', transaction: message() } } }
  const insight = {
    async simulate(input: { transactionBase64: string; expectedMessageHash: string }) {
      assert.equal(input.transactionBase64, 'AA==')
      return {
        messageHash: input.expectedMessageHash,
        signatureState: 'UNSIGNED' as const,
        status: 'SIMULATED' as const,
        contextCommitment: {
          namespace: 'insight.solana-simulation-receipt.v1',
          algorithm: 'sha256' as const,
          digest: `0x${'a'.repeat(64)}`,
        },
        receipt: { schema: 'insight.solana-simulation-receipt.v1' },
      }
    },
  }
  const prepared = await prepareGuardedJupiterSwap(request(), { router, compiler, insight, policy: policy(), now: () => 1_800_000_000_000 })
  assert.equal(prepared.intent.amount, '1000000')
  assert.equal(prepared.intent.asset, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  assert.equal(prepared.intent.validUntil, 1_800_000_060)
  assert.deepEqual(prepared.intent.contextCommitments, [prepared.simulation.contextCommitment])
})

test('refuses Jupiter instructions and compiled programs outside policy before simulation', async () => {
  const unsafeBuild = build()
  unsafeBuild.swapInstruction = { ...unsafeBuild.swapInstruction, programId: WALLET }
  let compiled = false
  await assert.rejects(
    prepareGuardedJupiterSwap(request(), {
      router: { async build() { return unsafeBuild } },
      compiler: { async compile() { compiled = true; return { transactionBase64: 'AA==', transaction: message() } } },
      insight: { async simulate() { throw new Error('must not simulate') } },
      policy: policy(),
    }),
    (error) => error instanceof JupiterGuardedSwapError && error.code === 'PROGRAM_NOT_ALLOWED',
  )
  assert.equal(compiled, false)

  await assert.rejects(
    prepareGuardedJupiterSwap(request(), {
      router: { async build() { return build() } },
      compiler: { async compile() { return { transactionBase64: 'AA==', transaction: message(USDC) } } },
      insight: { async simulate() { throw new Error('must not simulate') } },
      policy: policy(),
    }),
    (error) => error instanceof JupiterGuardedSwapError && error.code === 'COMPILED_PROGRAM_NOT_ALLOWED',
  )
})

test('binds every compiled instruction to Jupiter instruction data and account metas', async () => {
  await assert.rejects(
    prepareGuardedJupiterSwap(request(), {
      router: { async build() { return build() } },
      compiler: {
        async compile() {
          return {
            transactionBase64: 'AA==',
            transaction: { ...message(), instructions: [{ programIdIndex: 1, accountIndexes: [], data: '2' }] },
          }
        },
      },
      insight: { async simulate() { throw new Error('must not simulate') } },
      policy: policy(),
    }),
    (error) => error instanceof JupiterGuardedSwapError && error.code === 'JUPITER_INSTRUCTION_SEQUENCE_MISMATCH',
  )
})

test('permits only the transaction-wide privilege union required by Jupiter instructions', async () => {
  const route = build()
  route.setupInstructions = [{ programId: TOKEN_PROGRAM, accounts: [{ pubkey: WALLET, isSigner: true, isWritable: true }], data: 'AA==' }]
  route.swapInstruction = { programId: TOKEN_PROGRAM, accounts: [{ pubkey: WALLET, isSigner: true, isWritable: false }], data: 'AQ==' }
  const compiled = {
    ...message(),
    instructions: [
      { programIdIndex: 1, accountIndexes: [0], data: '1' },
      { programIdIndex: 1, accountIndexes: [0], data: '2' },
    ],
  }
  const prepared = await prepareGuardedJupiterSwap(request(), {
    router: { async build() { return route } },
    compiler: { async compile() { return { transactionBase64: 'AA==', transaction: compiled } } },
    insight: { async simulate(input: { expectedMessageHash: string }) { return { messageHash: input.expectedMessageHash, signatureState: 'UNSIGNED' as const, status: 'SIMULATED' as const, contextCommitment: { namespace: 'insight.solana-simulation-receipt.v1', algorithm: 'sha256' as const, digest: `0x${'b'.repeat(64)}` }, receipt: {} } } },
    policy: policy(), now: () => 1_800_000_000_000,
  })
  assert.equal(prepared.transaction.instructions.length, 2)
})

test('enforces output floor and durable mint admission before a route is built', async () => {
  await assert.rejects(
    prepareGuardedJupiterSwap({ ...request(), minimumOutputAmountAtomic: '990001' }, {
      router: { async build() { return build() } }, compiler: { async compile() { throw new Error('must not compile') } }, insight: { async simulate() { throw new Error('must not simulate') } }, policy: policy(),
    }),
    (error) => error instanceof JupiterGuardedSwapError && error.code === 'OUTPUT_AMOUNT_BELOW_REQUEST_MINIMUM',
  )
  await assert.rejects(
    prepareGuardedJupiterSwap(request(), {
      router: { async build() { throw new Error('must not build') } }, compiler: { async compile() { throw new Error('must not compile') } }, insight: { async simulate() { throw new Error('must not simulate') } },
      policy: { ...policy(), allowedOutputMints: [USDC] },
    }),
    (error) => error instanceof JupiterGuardedSwapError && error.code === 'OUTPUT_MINT_NOT_ALLOWED',
  )
})

test('creates a safe signing review and refuses a tampered prepared object', async () => {
  const prepared = await prepareGuardedJupiterSwap(request(), {
    router: { async build() { return build() } }, compiler: { async compile() { return { transactionBase64: 'AA==', transaction: message() } } },
    insight: { async simulate(input: { expectedMessageHash: string }) { return { messageHash: input.expectedMessageHash, signatureState: 'UNSIGNED' as const, status: 'SIMULATED' as const, contextCommitment: { namespace: 'insight.solana-simulation-receipt.v1', algorithm: 'sha256' as const, digest: `0x${'e'.repeat(64)}` }, receipt: {} } } },
    policy: policy(), now: () => 1_800_000_000_000,
  })
  const review = await reviewGuardedJupiterSwap(prepared, () => 1_800_000_010_000)
  assert.deepEqual(review.output, { mint: SOLANA_NATIVE_WRAPPED_MINT, minimumAmountAtomic: '990000' })
  assert.deepEqual(review.warnings, ['ADDRESS_LOOKUP_TABLES_NOT_PINNED', 'PRIORITY_FEE_NOT_CAPPED', 'WRAPPED_SOL_OUTPUT'])
  const byteTampered = structuredClone(prepared)
  byteTampered.transactionBase64 = 'AQ=='
  await assert.rejects(assertPreparedGuardedJupiterSwap(byteTampered, () => 1_800_000_010_000), (error) => error instanceof JupiterGuardedSwapError && error.code === 'PREPARED_TRANSACTION_BYTES_MISMATCH')
  prepared.transaction.instructions[0]!.data = '2'
  await assert.rejects(assertPreparedGuardedJupiterSwap(prepared, () => 1_800_000_010_000), (error) => error instanceof JupiterGuardedSwapError && error.code === 'PREPARED_MESSAGE_MISMATCH')
})

test('refuses an Insight response that does not attest to the exact final message', async () => {
  await assert.rejects(
    prepareGuardedJupiterSwap(request(), {
      router: { async build() { return build() } },
      compiler: { async compile() { return { transactionBase64: 'AA==', transaction: message() } } },
      insight: {
        async simulate() {
          return {
            messageHash: `0x${'b'.repeat(64)}`,
            signatureState: 'UNSIGNED' as const,
            status: 'SIMULATED' as const,
            contextCommitment: { namespace: 'insight.solana-simulation-receipt.v1', algorithm: 'sha256' as const, digest: `0x${'a'.repeat(64)}` },
            receipt: {},
          }
        },
      },
      policy: policy(),
    }),
    (error) => error instanceof JupiterGuardedSwapError && error.code === 'SIMULATION_MESSAGE_MISMATCH',
  )
})

test('Jupiter and Insight HTTP clients validate their responses and keep API keys out of URLs', async () => {
  let jupiterUrl = ''
  const router = createJupiterRouterClient({
    apiKey: 'jupiter-secret',
    baseUrl: 'https://jupiter.test/swap/v2/build',
    fetch: async (url, init) => {
      jupiterUrl = String(url)
      assert.equal(new Headers(init?.headers).get('x-api-key'), 'jupiter-secret')
      const { addressLookupTableAddresses: _legacyTables, ...currentBuild } = build()
      return json({
        ...currentBuild,
        addressesByLookupTableAddress: { [WALLET]: [USDC, USDC] },
      })
    },
  })
  const parsedBuild = await router.build({ ...request(), mode: 'standard' })
  assert.equal(parsedBuild.inAmount, '1000000')
  assert.deepEqual(parsedBuild.addressLookupTableAddresses, [WALLET])
  assert.match(jupiterUrl, /inputMint=EPjFW/)
  assert.match(jupiterUrl, /mode=default/)
  assert.doesNotMatch(jupiterUrl, /mode=standard/)
  assert.doesNotMatch(jupiterUrl, /jupiter-secret/)

  const insight = createInsightSolanaSimulationClient({
    apiKey: 'insight-secret',
    baseUrl: 'https://insight.test',
    fetch: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('x-api-key'), 'insight-secret')
      return json({
        data: {
          receipt: {
            schema: 'insight.solana-simulation-receipt.v1',
            payload: { simulation: { messageHash: `0x${'c'.repeat(64)}`, signatureState: 'UNSIGNED', status: 'SIMULATED' } },
          },
          contextCommitment: { namespace: 'insight.solana-simulation-receipt.v1', algorithm: 'sha256', digest: `0x${'d'.repeat(64)}` },
        },
      })
    },
  })
  const result = await insight.simulate({ transactionBase64: 'AA==', expectedMessageHash: `0x${'c'.repeat(64)}` })
  assert.equal(result.messageHash, `0x${'c'.repeat(64)}`)
})
