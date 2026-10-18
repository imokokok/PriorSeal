import { PriorSealClient } from './client.js'
import { buildSolanaTransactionIntent, hashSolanaTransactionMessage, SOLANA_MAINNET_CAIP2 } from './solana-transaction.js'
import type {
  ContextCommitment,
  Intent,
  ObservationResult,
  SolanaMessageWallet,
  SolanaTransactionMessage,
} from './types.js'

/** Jupiter's v2 Router is used because it returns instructions that an
 * integrator can inspect and compile. This module deliberately never calls
 * Jupiter's managed /execute endpoint and never receives a signing key. */
export const JUPITER_ROUTER_BUILD_URL = 'https://api.jup.ag/swap/v2/build'
export const INSIGHT_SOLANA_SIMULATION_NAMESPACE = 'insight.solana-simulation-receipt.v1'
export const SOLANA_NATIVE_WRAPPED_MINT = 'So11111111111111111111111111111111111111112'
export const SOLANA_COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111'

export type JupiterInstructionAccount = {
  pubkey: string
  isSigner: boolean
  isWritable: boolean
}

export type JupiterInstruction = {
  programId: string
  accounts: JupiterInstructionAccount[]
  /** Canonical base64 instruction bytes supplied by Jupiter. */
  data: string
}

export type JupiterRouterBuildRequest = {
  inputMint: string
  outputMint: string
  /** Atomic input amount, represented as a base-10 string. */
  amount: string
  /** The self-custodial wallet that owns the input and pays transaction fees. */
  taker: string
  slippageBps: number
  maxAccounts?: number
  mode?: 'standard' | 'fast'
}

export type JupiterRouterBuild = {
  inputMint: string
  outputMint: string
  inAmount: string
  otherAmountThreshold: string
  swapMode: 'ExactIn'
  slippageBps: number
  computeBudgetInstructions: JupiterInstruction[]
  setupInstructions: JupiterInstruction[]
  swapInstruction: JupiterInstruction
  cleanupInstruction: JupiterInstruction | null
  otherInstructions: JupiterInstruction[]
  tipInstruction: JupiterInstruction | null
  addressLookupTableAddresses: string[]
}

export type JupiterRouterClientOptions = {
  apiKey?: string
  baseUrl?: string
  fetch?: typeof fetch
}

export type JupiterRouterClient = {
  build(request: JupiterRouterBuildRequest, options?: { signal?: AbortSignal }): Promise<JupiterRouterBuild>
}

export type InsightSolanaSimulation = {
  messageHash: string
  signatureState: 'UNSIGNED'
  status: 'SIMULATED'
  contextCommitment: ContextCommitment
  /** Signed Insight receipt bytes are opaque to this adapter. Pin and verify Insight keys separately. */
  receipt: Record<string, unknown>
}

export type InsightSolanaSimulationClient = {
  simulate(input: { transactionBase64: string; expectedMessageHash: string }, options?: { signal?: AbortSignal }): Promise<InsightSolanaSimulation>
}

export type InsightSolanaSimulationClientOptions = {
  apiKey: string
  baseUrl?: string
  fetch?: typeof fetch
}

/**
 * The host application owns this boundary because it also owns its Solana RPC,
 * address-lookup-table resolver, current blockhash and wallet SDK. The returned
 * message must be the exact message in transactionBase64; Insight independently
 * enforces that equality by checking expectedMessageHash during simulation.
 */
export type JupiterTransactionCompiler = {
  compile(input: {
    build: JupiterRouterBuild
    request: JupiterRouterBuildRequest
    policy: JupiterGuardPolicy
  }, options?: { signal?: AbortSignal }): Promise<{
    transactionBase64: string
    transaction: SolanaTransactionMessage
  }>
}

export type JupiterGuardPolicy = {
  /** The policy is for a self-paying, single-signature wallet only. */
  feePayer: string
  maxInputAmountAtomic: string
  maxSlippageBps: number
  /** Optional durable asset admission controls for a deployment. */
  allowedInputMints?: string[]
  allowedOutputMints?: string[]
  /** Every program in the final compiled message must be explicitly admitted. */
  allowedProgramIds: string[]
  /** If set, final ALT accounts must be both returned by Jupiter and listed here. */
  allowedAddressLookupTables?: string[]
  /** Jupiter tips are a separate SOL transfer and remain disabled by default. */
  allowTipInstruction?: boolean
  maxComputeUnitLimit?: number
  maxComputeUnitPriceMicroLamports?: string
  maxPriorityFeeLamports?: string
  /** Authorization validity, starting when the final transaction is prepared. */
  authorizationTtlSeconds: number
}

export type GuardedJupiterSwapRequest = JupiterRouterBuildRequest & {
  intentId: string
  /** A caller-visible floor for the atomic output amount. */
  minimumOutputAmountAtomic?: string
  /** The source asset field included in PriorSeal's exact-message intent. */
  sourceAssetId?: string
  contextCommitments?: ContextCommitment[]
}

export type PreparedGuardedJupiterSwap = {
  schema: 'priorseal.jupiter-guarded-swap.v1'
  request: GuardedJupiterSwapRequest
  policy: JupiterGuardPolicy
  build: JupiterRouterBuild
  transactionBase64: string
  /** SHA-256 of the exact unsigned transaction bytes handed to Insight. */
  transactionDigest: string
  transaction: SolanaTransactionMessage
  messageHash: string
  simulation: InsightSolanaSimulation
  intent: Intent
}

export type PrepareGuardedJupiterSwapOptions = {
  router: JupiterRouterClient
  compiler: JupiterTransactionCompiler
  insight: InsightSolanaSimulationClient
  policy: JupiterGuardPolicy
  now?: () => number
  signal?: AbortSignal
}

export type AuthorizeGuardedJupiterSwapInput = {
  client: PriorSealClient
  prepared: PreparedGuardedJupiterSwap
  wallet: SolanaMessageWallet
  principal: { type: 'user' | 'organization'; id: string }
  agentId: string
  audience?: string
  /** Testable clock source; values are Unix milliseconds. */
  now?: () => number
  signal?: AbortSignal
}

/** A non-secret, serializable review shown before a wallet signs anything. */
export type GuardedJupiterSwapReview = {
  schema: 'priorseal.jupiter-guarded-swap-review.v1'
  intentId: string
  messageHash: string
  transactionDigest: string
  feePayer: string
  input: { mint: string; amountAtomic: string; assetId: string }
  output: { mint: string; minimumAmountAtomic: string }
  slippageBps: number
  validUntil: number
  instructionCount: number
  programIds: string[]
  addressLookupTables: string[]
  computeBudget: { computeUnitLimit: string | null; computeUnitPriceMicroLamports: string | null; maximumPriorityFeeLamports: string | null }
  warnings: Array<'ADDRESS_LOOKUP_TABLES_NOT_PINNED' | 'PRIORITY_FEE_NOT_CAPPED' | 'WRAPPED_SOL_OUTPUT'>
}

/** Creates a narrowly scoped client for Jupiter's raw-instruction Router API. */
export function createJupiterRouterClient(options: JupiterRouterClientOptions = {}): JupiterRouterClient {
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) throw new TypeError('Jupiter Router client requires a Fetch-compatible implementation')
  const endpoint = (options.baseUrl ?? JUPITER_ROUTER_BUILD_URL).replace(/\/$/, '')
  if (!/^https:\/\//.test(endpoint)) throw new TypeError('Jupiter Router baseUrl must use HTTPS')
  const apiKey = options.apiKey?.trim()
  return {
    async build(request, requestOptions = {}) {
      assertBuildRequest(request)
      const query = new URLSearchParams({
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount,
        taker: request.taker,
        slippageBps: String(request.slippageBps),
      })
      if (request.maxAccounts !== undefined) query.set('maxAccounts', String(request.maxAccounts))
      // The guarded API intentionally exposes the product-level name
      // `standard`; Jupiter's Router API calls that same mode `default`.
      // Keep the boundary explicit so a provider vocabulary change cannot
      // silently alter the reviewed request semantics.
      if (request.mode !== undefined) query.set('mode', request.mode === 'standard' ? 'default' : request.mode)
      const response = await fetcher(`${endpoint}?${query.toString()}`, {
        headers: { accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
        signal: requestOptions.signal,
      })
      const body = await responseJson(response, 'Jupiter Router')
      if (!response.ok) throw new JupiterGuardedSwapError('JUPITER_BUILD_REJECTED', readFailureMessage(body, 'Jupiter Router rejected the build request'))
      const build = parseJupiterRouterBuild(body)
      assertBuildMatchesRequest(build, request)
      return build
    },
  }
}

/** Creates a strict client for Insight's already available Solana simulation endpoint. */
export function createInsightSolanaSimulationClient(options: InsightSolanaSimulationClientOptions): InsightSolanaSimulationClient {
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) throw new TypeError('Insight simulation client requires a Fetch-compatible implementation')
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new TypeError('Insight simulation API key is required')
  const origin = (options.baseUrl ?? 'https://www.oracleinsight.xyz').replace(/\/$/, '')
  if (!/^https:\/\//.test(origin)) throw new TypeError('Insight baseUrl must use HTTPS')
  return {
    async simulate(input, requestOptions = {}) {
      assertCanonicalBase64(input.transactionBase64, 'transactionBase64')
      assertDigest(input.expectedMessageHash, 'expectedMessageHash')
      const response = await fetcher(`${origin}/api/v1/execution/solana/simulate`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(input),
        signal: requestOptions.signal,
      })
      const body = await responseJson(response, 'Insight')
      if (!response.ok) throw new JupiterGuardedSwapError('INSIGHT_SIMULATION_REJECTED', readFailureMessage(body, 'Insight rejected the Solana simulation'))
      return parseInsightSimulation(body, input.expectedMessageHash)
    },
  }
}

/**
 * Builds and simulates a final Jupiter Router transaction, checks the entire
 * compiled message against policy, and returns a PriorSeal intent. It does not
 * sign, send or retry a transaction.
 */
export async function prepareGuardedJupiterSwap(
  request: GuardedJupiterSwapRequest,
  options: PrepareGuardedJupiterSwapOptions,
): Promise<PreparedGuardedJupiterSwap> {
  assertGuardedRequest(request)
  assertPolicy(options.policy)
  assertAssetPolicy(request, options.policy)
  if (request.taker !== options.policy.feePayer) {
    throw new JupiterGuardedSwapError('FEE_PAYER_MISMATCH', 'The Jupiter taker must be the self-paying policy wallet')
  }
  if (BigInt(request.amount) > BigInt(options.policy.maxInputAmountAtomic)) {
    throw new JupiterGuardedSwapError('INPUT_AMOUNT_EXCEEDS_POLICY', 'The requested input amount exceeds the policy limit')
  }
  if (request.slippageBps > options.policy.maxSlippageBps) {
    throw new JupiterGuardedSwapError('SLIPPAGE_EXCEEDS_POLICY', 'The requested slippage exceeds the policy limit')
  }
  const build = await options.router.build(request, { signal: options.signal })
  if (request.minimumOutputAmountAtomic !== undefined && BigInt(build.otherAmountThreshold) < BigInt(request.minimumOutputAmountAtomic)) {
    throw new JupiterGuardedSwapError('OUTPUT_AMOUNT_BELOW_REQUEST_MINIMUM', 'Jupiter minimum output is below the requested output floor')
  }
  assertRawBuildPrograms(build, options.policy)
  const compiled = await options.compiler.compile({ build, request, policy: options.policy }, { signal: options.signal })
  assertCanonicalBase64(compiled.transactionBase64, 'compiled transactionBase64')
  const transactionDigest = await hashTransactionBytes(compiled.transactionBase64)
  const messageHash = await hashSolanaTransactionMessage(compiled.transaction)
  assertCompiledTransaction(compiled.transaction, build, request, options.policy)
  const simulation = await options.insight.simulate({
    transactionBase64: compiled.transactionBase64,
    expectedMessageHash: messageHash,
  }, { signal: options.signal })
  if (simulation.messageHash !== messageHash) {
    throw new JupiterGuardedSwapError('SIMULATION_MESSAGE_MISMATCH', 'Insight simulation did not attest to the exact compiled transaction message')
  }
  const now = Math.floor((options.now ?? Date.now)() / 1000)
  const validUntil = now + options.policy.authorizationTtlSeconds
  const sourceAssetId = request.sourceAssetId ?? solanaAssetIdForMint(request.inputMint)
  const commitments = [...(request.contextCommitments ?? []), simulation.contextCommitment]
  assertDistinctCommitments(commitments)
  const intent = buildSolanaTransactionIntent({
    intentId: request.intentId,
    asset: sourceAssetId,
    amount: request.amount,
    validUntil,
    transaction: compiled.transaction,
    contextCommitments: commitments,
  })
  return {
    schema: 'priorseal.jupiter-guarded-swap.v1', request, policy: clonePolicy(options.policy), build,
    transactionBase64: compiled.transactionBase64, transactionDigest, transaction: compiled.transaction, messageHash, simulation, intent,
  }
}

/** Obtains a principal-controlled, exact-message PriorSeal authorization. */
export function authorizeGuardedJupiterSwap(input: AuthorizeGuardedJupiterSwapInput): ReturnType<PriorSealClient['authorizeWithSolanaWallet']> {
  return authorizePreparedGuardedJupiterSwap(input)
}

async function authorizePreparedGuardedJupiterSwap(input: AuthorizeGuardedJupiterSwapInput): Promise<Awaited<ReturnType<PriorSealClient['authorizeWithSolanaWallet']>>> {
  const { prepared } = input
  await assertPreparedGuardedJupiterSwap(prepared, input.now)
  return input.client.authorizeWithSolanaWallet({
    intent: prepared.intent,
    principal: input.principal,
    delegate: { agentId: input.agentId, executor: prepared.transaction.feePayer },
    ...(input.audience ? { audience: input.audience } : {}),
  }, input.wallet, { signal: input.signal })
}

/**
 * Revalidates a prepared object immediately before authorization. This is
 * useful when preparation and wallet-signing live in different application
 * components or an object crossed a persistence boundary.
 */
export async function assertPreparedGuardedJupiterSwap(prepared: PreparedGuardedJupiterSwap, now: (() => number) | undefined = undefined): Promise<void> {
  if (!prepared || prepared.schema !== 'priorseal.jupiter-guarded-swap.v1') throw new TypeError('prepared guarded Jupiter swap is invalid')
  assertGuardedRequest(prepared.request)
  assertPolicy(prepared.policy)
  assertAssetPolicy(prepared.request, prepared.policy)
  assertBuildMatchesRequest(prepared.build, prepared.request)
  if (prepared.request.minimumOutputAmountAtomic !== undefined && BigInt(prepared.build.otherAmountThreshold) < BigInt(prepared.request.minimumOutputAmountAtomic)) {
    throw new JupiterGuardedSwapError('OUTPUT_AMOUNT_BELOW_REQUEST_MINIMUM', 'Jupiter minimum output is below the requested output floor')
  }
  assertRawBuildPrograms(prepared.build, prepared.policy)
  assertCanonicalBase64(prepared.transactionBase64, 'prepared transactionBase64')
  assertDigest(prepared.transactionDigest, 'prepared transactionDigest')
  if (await hashTransactionBytes(prepared.transactionBase64) !== prepared.transactionDigest) throw new JupiterGuardedSwapError('PREPARED_TRANSACTION_BYTES_MISMATCH', 'The prepared transaction bytes were changed after Insight simulation')
  const messageHash = await hashSolanaTransactionMessage(prepared.transaction)
  if (messageHash !== prepared.messageHash || prepared.simulation.messageHash !== messageHash) throw new JupiterGuardedSwapError('PREPARED_MESSAGE_MISMATCH', 'The prepared transaction or simulation no longer matches its recorded message hash')
  assertCompiledTransaction(prepared.transaction, prepared.build, prepared.request, prepared.policy)
  if (prepared.intent.intentId !== prepared.request.intentId || prepared.intent.amount !== prepared.request.amount || prepared.intent.asset !== (prepared.request.sourceAssetId ?? solanaAssetIdForMint(prepared.request.inputMint)) || prepared.intent.sender !== prepared.transaction.feePayer || prepared.intent.recipient !== prepared.transaction.feePayer || !prepared.intent.solanaTransaction) {
    throw new JupiterGuardedSwapError('PREPARED_INTENT_MISMATCH', 'The prepared PriorSeal intent no longer matches the guarded swap')
  }
  if (await hashSolanaTransactionMessage(prepared.intent.solanaTransaction) !== messageHash) throw new JupiterGuardedSwapError('PREPARED_INTENT_MISMATCH', 'The PriorSeal intent is not bound to the prepared transaction')
  const commitments = prepared.intent.contextCommitments ?? []
  assertDistinctCommitments(commitments)
  if (!commitments.some((entry) => sameCommitment(entry, prepared.simulation.contextCommitment))) throw new JupiterGuardedSwapError('PREPARED_SIMULATION_COMMITMENT_MISSING', 'The prepared intent is missing the Insight simulation commitment')
  if (prepared.intent.validUntil <= Math.floor((now ?? Date.now)() / 1000)) throw new JupiterGuardedSwapError('PREPARED_AUTHORIZATION_EXPIRED', 'The prepared transaction authorization window has expired; start a new guarded swap')
}

/** Creates a safe-to-log review record from an already revalidated swap. */
export async function reviewGuardedJupiterSwap(prepared: PreparedGuardedJupiterSwap, now?: () => number): Promise<GuardedJupiterSwapReview> {
  await assertPreparedGuardedJupiterSwap(prepared, now)
  const allAccounts = [...prepared.transaction.accountKeys, ...prepared.transaction.loadedAddresses.writable, ...prepared.transaction.loadedAddresses.readonly]
  const computeBudget = inspectComputeBudget(prepared.transaction, allAccounts)
  const programs = [...new Set(prepared.transaction.instructions.map((instruction) => allAccounts[instruction.programIdIndex]!))].sort()
  const warnings: GuardedJupiterSwapReview['warnings'] = []
  if (prepared.policy.allowedAddressLookupTables === undefined) warnings.push('ADDRESS_LOOKUP_TABLES_NOT_PINNED')
  if (prepared.policy.maxPriorityFeeLamports === undefined) warnings.push('PRIORITY_FEE_NOT_CAPPED')
  if (prepared.request.outputMint === SOLANA_NATIVE_WRAPPED_MINT) warnings.push('WRAPPED_SOL_OUTPUT')
  return {
    schema: 'priorseal.jupiter-guarded-swap-review.v1', intentId: prepared.request.intentId, messageHash: prepared.messageHash, transactionDigest: prepared.transactionDigest,
    feePayer: prepared.transaction.feePayer,
    input: { mint: prepared.request.inputMint, amountAtomic: prepared.request.amount, assetId: prepared.intent.asset },
    output: { mint: prepared.request.outputMint, minimumAmountAtomic: prepared.build.otherAmountThreshold },
    slippageBps: prepared.build.slippageBps, validUntil: prepared.intent.validUntil,
    instructionCount: prepared.transaction.instructions.length, programIds: programs,
    addressLookupTables: prepared.transaction.addressTableLookups.map((entry) => entry.accountKey),
    computeBudget: {
      computeUnitLimit: computeBudget.limit?.toString() ?? null,
      computeUnitPriceMicroLamports: computeBudget.price?.toString() ?? null,
      maximumPriorityFeeLamports: computeBudget.priorityFee?.toString() ?? null,
    },
    warnings,
  }
}

/** Observe a submitted signature. Passing a changed transaction to submit is never allowed. */
export function observeGuardedJupiterSwap(input: {
  client: PriorSealClient
  authorizationId: string
  signature: string
  confirmations?: number
  signal?: AbortSignal
}): Promise<ObservationResult> {
  assertSolanaSignature(input.signature)
  if (!validIdentifier(input.authorizationId)) throw new TypeError('authorizationId is invalid')
  return input.client.observeExecutionUntilFinal({
    authorizationId: input.authorizationId,
    chainId: 0,
    txHash: input.signature,
    confirmations: input.confirmations ?? 0,
  }, { signal: input.signal })
}

/** Maps Jupiter's wrapped-SOL mint to the CAIP-19 native-SOL identifier. */
export function solanaAssetIdForMint(mint: string): string {
  assertPublicKey(mint, 'mint')
  return mint === SOLANA_NATIVE_WRAPPED_MINT
    ? `${SOLANA_MAINNET_CAIP2}/slip44:501`
    : `${SOLANA_MAINNET_CAIP2}/spl:${mint}`
}

export class JupiterGuardedSwapError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'JupiterGuardedSwapError'
    this.code = code
  }
}

function assertGuardedRequest(value: GuardedJupiterSwapRequest): void {
  assertBuildRequest(value)
  if (!validIdentifier(value.intentId)) throw new TypeError('intentId is invalid')
  if (value.minimumOutputAmountAtomic !== undefined) {
    assertUnsigned(value.minimumOutputAmountAtomic, 'minimumOutputAmountAtomic')
    if (value.minimumOutputAmountAtomic === '0') throw new TypeError('minimumOutputAmountAtomic must be positive')
  }
  if (value.sourceAssetId !== undefined && value.sourceAssetId !== solanaAssetIdForMint(value.inputMint)) {
    throw new TypeError('sourceAssetId must identify the requested Jupiter input mint')
  }
  if (value.contextCommitments !== undefined) assertDistinctCommitments(value.contextCommitments)
}

function assertBuildRequest(value: JupiterRouterBuildRequest): void {
  if (!value || typeof value !== 'object') throw new TypeError('Jupiter build request is required')
  assertPublicKey(value.inputMint, 'inputMint')
  assertPublicKey(value.outputMint, 'outputMint')
  assertPublicKey(value.taker, 'taker')
  if (value.inputMint === value.outputMint) throw new TypeError('inputMint and outputMint must differ')
  assertUnsigned(value.amount, 'amount')
  if (!Number.isSafeInteger(value.slippageBps) || value.slippageBps < 0 || value.slippageBps > 10_000) throw new TypeError('slippageBps must be an integer from 0 through 10000')
  if (value.maxAccounts !== undefined && (!Number.isSafeInteger(value.maxAccounts) || value.maxAccounts < 1 || value.maxAccounts > 64)) throw new TypeError('maxAccounts must be an integer from 1 through 64')
  if (value.mode !== undefined && value.mode !== 'standard' && value.mode !== 'fast') throw new TypeError('mode must be standard or fast')
}

function assertPolicy(policy: JupiterGuardPolicy): void {
  if (!policy || typeof policy !== 'object') throw new TypeError('Jupiter guard policy is required')
  assertPublicKey(policy.feePayer, 'policy.feePayer')
  assertUnsigned(policy.maxInputAmountAtomic, 'policy.maxInputAmountAtomic')
  if (policy.maxInputAmountAtomic === '0') throw new TypeError('policy.maxInputAmountAtomic must be positive')
  if (!Number.isSafeInteger(policy.maxSlippageBps) || policy.maxSlippageBps < 0 || policy.maxSlippageBps > 10_000) throw new TypeError('policy.maxSlippageBps must be an integer from 0 through 10000')
  assertOptionalPublicKeyList(policy.allowedInputMints, 'policy.allowedInputMints')
  assertOptionalPublicKeyList(policy.allowedOutputMints, 'policy.allowedOutputMints')
  if (!Array.isArray(policy.allowedProgramIds) || policy.allowedProgramIds.length === 0 || policy.allowedProgramIds.length > 64 || new Set(policy.allowedProgramIds).size !== policy.allowedProgramIds.length) throw new TypeError('policy.allowedProgramIds must be a non-empty unique list')
  policy.allowedProgramIds.forEach((programId, index) => assertPublicKey(programId, `policy.allowedProgramIds[${index}]`))
  if (policy.allowedAddressLookupTables !== undefined) {
    if (!Array.isArray(policy.allowedAddressLookupTables) || policy.allowedAddressLookupTables.length > 32 || new Set(policy.allowedAddressLookupTables).size !== policy.allowedAddressLookupTables.length) throw new TypeError('policy.allowedAddressLookupTables must be a unique list')
    policy.allowedAddressLookupTables.forEach((address, index) => assertPublicKey(address, `policy.allowedAddressLookupTables[${index}]`))
  }
  if (policy.allowTipInstruction !== undefined && typeof policy.allowTipInstruction !== 'boolean') throw new TypeError('policy.allowTipInstruction must be boolean')
  if (policy.maxComputeUnitLimit !== undefined && (!Number.isSafeInteger(policy.maxComputeUnitLimit) || policy.maxComputeUnitLimit < 1 || policy.maxComputeUnitLimit > 1_400_000)) throw new TypeError('policy.maxComputeUnitLimit is invalid')
  if (policy.maxComputeUnitPriceMicroLamports !== undefined) assertUnsigned(policy.maxComputeUnitPriceMicroLamports, 'policy.maxComputeUnitPriceMicroLamports')
  if (policy.maxPriorityFeeLamports !== undefined) assertUnsigned(policy.maxPriorityFeeLamports, 'policy.maxPriorityFeeLamports')
  if (!Number.isSafeInteger(policy.authorizationTtlSeconds) || policy.authorizationTtlSeconds < 10 || policy.authorizationTtlSeconds > 120) throw new TypeError('policy.authorizationTtlSeconds must be an integer from 10 through 120')
}

function parseJupiterRouterBuild(value: unknown): JupiterRouterBuild {
  const record = asRecord(value, 'Jupiter Router response')
  const inputMint = readPublicKey(record.inputMint, 'Jupiter inputMint')
  const outputMint = readPublicKey(record.outputMint, 'Jupiter outputMint')
  const inAmount = readUnsigned(record.inAmount, 'Jupiter inAmount')
  const otherAmountThreshold = readUnsigned(record.otherAmountThreshold, 'Jupiter otherAmountThreshold')
  if (record.swapMode !== 'ExactIn') throw new JupiterGuardedSwapError('UNSUPPORTED_SWAP_MODE', 'Jupiter guarded swaps support ExactIn only')
  const slippageBps = readInteger(record.slippageBps, 'Jupiter slippageBps', 0, 10_000)
  return {
    inputMint, outputMint, inAmount, otherAmountThreshold, swapMode: 'ExactIn', slippageBps,
    computeBudgetInstructions: readInstructions(record.computeBudgetInstructions, 'computeBudgetInstructions'),
    setupInstructions: readInstructions(record.setupInstructions, 'setupInstructions'),
    swapInstruction: readInstruction(record.swapInstruction, 'swapInstruction'),
    cleanupInstruction: readNullableInstruction(record.cleanupInstruction, 'cleanupInstruction'),
    otherInstructions: readInstructions(record.otherInstructions, 'otherInstructions'),
    tipInstruction: readNullableInstruction(record.tipInstruction, 'tipInstruction'),
    addressLookupTableAddresses: readPublicKeys(record.addressLookupTableAddresses, 'addressLookupTableAddresses', 32),
  }
}

function assertBuildMatchesRequest(build: JupiterRouterBuild, request: JupiterRouterBuildRequest): void {
  if (build.inputMint !== request.inputMint || build.outputMint !== request.outputMint || build.inAmount !== request.amount || build.slippageBps > request.slippageBps || build.otherAmountThreshold === '0') {
    throw new JupiterGuardedSwapError('JUPITER_BUILD_MISMATCH', 'Jupiter build response does not match the requested exact-in swap bounds')
  }
}

function assertAssetPolicy(request: JupiterRouterBuildRequest, policy: JupiterGuardPolicy): void {
  if (policy.allowedInputMints !== undefined && !policy.allowedInputMints.includes(request.inputMint)) throw new JupiterGuardedSwapError('INPUT_MINT_NOT_ALLOWED', 'The requested input mint is outside policy')
  if (policy.allowedOutputMints !== undefined && !policy.allowedOutputMints.includes(request.outputMint)) throw new JupiterGuardedSwapError('OUTPUT_MINT_NOT_ALLOWED', 'The requested output mint is outside policy')
}

function assertRawBuildPrograms(build: JupiterRouterBuild, policy: JupiterGuardPolicy): void {
  if (build.tipInstruction && !policy.allowTipInstruction) throw new JupiterGuardedSwapError('TIP_INSTRUCTION_FORBIDDEN', 'Jupiter tip instructions are not permitted by this policy')
  const allowed = new Set(policy.allowedProgramIds)
  for (const instruction of allInstructions(build)) {
    if (!allowed.has(instruction.programId)) throw new JupiterGuardedSwapError('PROGRAM_NOT_ALLOWED', `Jupiter instruction program is not permitted: ${instruction.programId}`)
  }
  if (policy.allowedAddressLookupTables) {
    const configured = new Set(policy.allowedAddressLookupTables)
    for (const address of build.addressLookupTableAddresses) {
      if (!configured.has(address)) throw new JupiterGuardedSwapError('LOOKUP_TABLE_NOT_ALLOWED', `Jupiter address lookup table is not permitted: ${address}`)
    }
  }
}

function assertCompiledTransaction(
  transaction: SolanaTransactionMessage,
  build: JupiterRouterBuild,
  request: JupiterRouterBuildRequest,
  policy: JupiterGuardPolicy,
): void {
  if (transaction.network !== 'mainnet-beta' || transaction.feePayer !== request.taker || transaction.feePayer !== policy.feePayer || transaction.header.numRequiredSignatures !== 1) {
    throw new JupiterGuardedSwapError('COMPILED_SIGNER_POLICY_REJECTED', 'The final transaction must have the taker as its only required signer and fee payer')
  }
  const allAccounts = [...transaction.accountKeys, ...transaction.loadedAddresses.writable, ...transaction.loadedAddresses.readonly]
  const programs = transaction.instructions.map((instruction) => allAccounts[instruction.programIdIndex]).filter((program): program is string => typeof program === 'string')
  if (programs.length !== transaction.instructions.length) throw new JupiterGuardedSwapError('COMPILED_PROGRAM_INDEX_INVALID', 'The compiled transaction has an invalid program index')
  const allowed = new Set(policy.allowedProgramIds)
  for (const program of programs) {
    if (!allowed.has(program)) throw new JupiterGuardedSwapError('COMPILED_PROGRAM_NOT_ALLOWED', `The final transaction uses a program outside policy: ${program}`)
  }
  const rawPrograms = new Set(allInstructions(build).map((instruction) => instruction.programId))
  for (const program of rawPrograms) {
    if (!programs.includes(program)) throw new JupiterGuardedSwapError('JUPITER_INSTRUCTION_OMITTED', `The final transaction omits a Jupiter instruction program: ${program}`)
  }
  assertExactInstructionSequence(transaction, build, allAccounts)
  const returnedLookupTables = new Set(build.addressLookupTableAddresses)
  for (const lookup of transaction.addressTableLookups) {
    if (!returnedLookupTables.has(lookup.accountKey)) throw new JupiterGuardedSwapError('UNEXPECTED_LOOKUP_TABLE', 'The final transaction uses an address lookup table not returned by Jupiter')
  }
  if (policy.allowedAddressLookupTables) {
    const configured = new Set(policy.allowedAddressLookupTables)
    for (const lookup of transaction.addressTableLookups) {
      if (!configured.has(lookup.accountKey)) throw new JupiterGuardedSwapError('LOOKUP_TABLE_NOT_ALLOWED', `The final transaction uses a lookup table outside policy: ${lookup.accountKey}`)
    }
  }
  assertComputeBudget(transaction, policy, allAccounts)
}

/**
 * Prevents a compiler from substituting account metas, data, instruction
 * ordering, or adding a second call to an otherwise allowed program. Program
 * allowlists alone cannot provide this property.
 */
function assertExactInstructionSequence(transaction: SolanaTransactionMessage, build: JupiterRouterBuild, accounts: string[]): void {
  const expected = allInstructions(build)
  if (transaction.instructions.length !== expected.length) throw new JupiterGuardedSwapError('JUPITER_INSTRUCTION_SEQUENCE_MISMATCH', 'The final transaction instruction count differs from Jupiter build')
  for (let index = 0; index < expected.length; index += 1) {
    const raw = expected[index]!
    const compiled = transaction.instructions[index]!
    if (accounts[compiled.programIdIndex] !== raw.programId || encodeBase58(decodeBase64(raw.data)) !== compiled.data || compiled.accountIndexes.length !== raw.accounts.length) {
      throw new JupiterGuardedSwapError('JUPITER_INSTRUCTION_SEQUENCE_MISMATCH', `The final transaction instruction ${index} differs from Jupiter build`)
    }
    for (let accountIndex = 0; accountIndex < raw.accounts.length; accountIndex += 1) {
      const expectedAccount = raw.accounts[accountIndex]!
      const compiledAccount = compiledAccountMeta(transaction, compiled.accountIndexes[accountIndex]!, accounts)
      if (compiledAccount.pubkey !== expectedAccount.pubkey || compiledAccount.isSigner !== expectedAccount.isSigner || compiledAccount.isWritable !== expectedAccount.isWritable) {
        throw new JupiterGuardedSwapError('JUPITER_INSTRUCTION_SEQUENCE_MISMATCH', `The final transaction account ${index}:${accountIndex} differs from Jupiter build`)
      }
    }
  }
}

function compiledAccountMeta(transaction: SolanaTransactionMessage, index: number, accounts: string[]): JupiterInstructionAccount {
  const staticCount = transaction.accountKeys.length
  const pubkey = accounts[index]
  if (!pubkey) throw new JupiterGuardedSwapError('COMPILED_PROGRAM_INDEX_INVALID', 'The compiled transaction has an invalid account index')
  if (index < staticCount) {
    const isSigner = index < transaction.header.numRequiredSignatures
    const firstReadonly = isSigner
      ? transaction.header.numRequiredSignatures - transaction.header.numReadonlySignedAccounts
      : staticCount - transaction.header.numReadonlyUnsignedAccounts
    return { pubkey, isSigner, isWritable: index < firstReadonly }
  }
  const writableEnd = staticCount + transaction.loadedAddresses.writable.length
  return { pubkey, isSigner: false, isWritable: index < writableEnd }
}

function assertComputeBudget(transaction: SolanaTransactionMessage, policy: JupiterGuardPolicy, accounts: string[]): void {
  const { limit: computeLimit, price: computePrice, priorityFee: v1PriorityTotal } = inspectComputeBudget(transaction, accounts)
  if (policy.maxComputeUnitLimit !== undefined && (computeLimit === null || computeLimit > BigInt(policy.maxComputeUnitLimit))) throw new JupiterGuardedSwapError('COMPUTE_LIMIT_EXCEEDS_POLICY', 'The final transaction compute-unit limit is missing or exceeds policy')
  if (policy.maxComputeUnitPriceMicroLamports !== undefined && (computePrice === null || computePrice > BigInt(policy.maxComputeUnitPriceMicroLamports))) throw new JupiterGuardedSwapError('COMPUTE_PRICE_EXCEEDS_POLICY', 'The final transaction compute-unit price is missing or exceeds policy')
  if (policy.maxPriorityFeeLamports !== undefined) {
    const total = v1PriorityTotal ?? (computeLimit !== null && computePrice !== null ? (computeLimit * computePrice + 999_999n) / 1_000_000n : null)
    if (total === null || total > BigInt(policy.maxPriorityFeeLamports)) throw new JupiterGuardedSwapError('PRIORITY_FEE_EXCEEDS_POLICY', 'The final transaction priority fee is missing or exceeds policy')
  }
}

function inspectComputeBudget(transaction: SolanaTransactionMessage, accounts: string[]): { limit: bigint | null; price: bigint | null; priorityFee: bigint | null } {
  let limit: bigint | null = transaction.transactionConfig?.computeUnitLimit == null ? null : BigInt(transaction.transactionConfig.computeUnitLimit)
  let price: bigint | null = null
  const priorityFee = transaction.messageVersion === 'v1' && transaction.transactionConfig?.priorityFeeLamports !== null && transaction.transactionConfig?.priorityFeeLamports !== undefined
    ? BigInt(transaction.transactionConfig.priorityFeeLamports)
    : null
  for (const instruction of transaction.instructions) {
    if (accounts[instruction.programIdIndex] !== SOLANA_COMPUTE_BUDGET_PROGRAM) continue
    const bytes = decodeBase58(instruction.data)
    if (bytes.length === 0) throw new JupiterGuardedSwapError('COMPUTE_BUDGET_INVALID', 'Compute-budget instruction data is empty')
    if (bytes[0] === 2 && bytes.length === 5) limit = BigInt(readU32LE(bytes, 1))
    else if (bytes[0] === 3 && bytes.length === 9) price = readU64LE(bytes, 1)
    else if (![1, 4].includes(bytes[0])) throw new JupiterGuardedSwapError('COMPUTE_BUDGET_INVALID', 'Unsupported compute-budget instruction')
  }
  return { limit, price, priorityFee }
}

function parseInsightSimulation(value: unknown, expectedMessageHash: string): InsightSolanaSimulation {
  const root = asRecord(value, 'Insight simulation response')
  const data = asRecord(root.data, 'Insight simulation response data')
  const receipt = asRecord(data.receipt, 'Insight simulation receipt')
  if (receipt.schema !== INSIGHT_SOLANA_SIMULATION_NAMESPACE) throw new JupiterGuardedSwapError('INSIGHT_RECEIPT_SCHEMA_INVALID', 'Insight returned an unexpected simulation receipt schema')
  const payload = asRecord(receipt.payload, 'Insight simulation receipt payload')
  const simulation = asRecord(payload.simulation, 'Insight simulation payload')
  const messageHash = readDigest(simulation.messageHash, 'Insight simulation messageHash')
  if (messageHash !== expectedMessageHash || simulation.signatureState !== 'UNSIGNED' || simulation.status !== 'SIMULATED') throw new JupiterGuardedSwapError('INSIGHT_SIMULATION_INVALID', 'Insight did not return a successful unsigned simulation for the exact message')
  const commitment = parseCommitment(data.contextCommitment)
  if (commitment.namespace !== INSIGHT_SOLANA_SIMULATION_NAMESPACE || commitment.algorithm !== 'sha256') throw new JupiterGuardedSwapError('INSIGHT_COMMITMENT_INVALID', 'Insight returned an invalid simulation context commitment')
  return { messageHash, signatureState: 'UNSIGNED', status: 'SIMULATED', contextCommitment: commitment, receipt }
}

function readInstructions(value: unknown, field: string): JupiterInstruction[] {
  if (!Array.isArray(value) || value.length > 64) throw new JupiterGuardedSwapError('JUPITER_RESPONSE_INVALID', `${field} must be an instruction array`)
  return value.map((entry, index) => readInstruction(entry, `${field}[${index}]`))
}

function readNullableInstruction(value: unknown, field: string): JupiterInstruction | null {
  return value == null ? null : readInstruction(value, field)
}

function readInstruction(value: unknown, field: string): JupiterInstruction {
  const record = asRecord(value, `Jupiter ${field}`)
  const programId = readPublicKey(record.programId, `Jupiter ${field}.programId`)
  if (!Array.isArray(record.accounts) || record.accounts.length > 256) throw new JupiterGuardedSwapError('JUPITER_RESPONSE_INVALID', `${field}.accounts must be an array`)
  const accounts = record.accounts.map((entry, index) => {
    const account = asRecord(entry, `Jupiter ${field}.accounts[${index}]`)
    if (typeof account.isSigner !== 'boolean' || typeof account.isWritable !== 'boolean') throw new JupiterGuardedSwapError('JUPITER_RESPONSE_INVALID', `${field}.accounts[${index}] flags are invalid`)
    return { pubkey: readPublicKey(account.pubkey, `Jupiter ${field}.accounts[${index}].pubkey`), isSigner: account.isSigner, isWritable: account.isWritable }
  })
  if (typeof record.data !== 'string') throw new JupiterGuardedSwapError('JUPITER_RESPONSE_INVALID', `${field}.data must be a base64 string`)
  assertCanonicalBase64(record.data, `${field}.data`)
  return { programId, accounts, data: record.data }
}

function readPublicKeys(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length) throw new JupiterGuardedSwapError('JUPITER_RESPONSE_INVALID', `${field} must be a unique public-key array`)
  return value.map((entry, index) => readPublicKey(entry, `${field}[${index}]`))
}

function allInstructions(build: JupiterRouterBuild): JupiterInstruction[] {
  return [
    ...build.computeBudgetInstructions,
    ...build.setupInstructions,
    build.swapInstruction,
    ...(build.cleanupInstruction ? [build.cleanupInstruction] : []),
    ...build.otherInstructions,
    ...(build.tipInstruction ? [build.tipInstruction] : []),
  ]
}

function parseCommitment(value: unknown): ContextCommitment {
  const record = asRecord(value, 'Insight contextCommitment')
  if (typeof record.namespace !== 'string' || (record.algorithm !== 'sha256' && record.algorithm !== 'keccak256')) throw new JupiterGuardedSwapError('INSIGHT_COMMITMENT_INVALID', 'Insight context commitment is malformed')
  const digest = readDigest(record.digest, 'Insight context commitment digest')
  return { namespace: record.namespace, algorithm: record.algorithm, digest }
}

function assertDistinctCommitments(commitments: ContextCommitment[]): void {
  const seen = new Set<string>()
  const namespaces = new Set<string>()
  for (const commitment of commitments) {
    if (!commitment || typeof commitment.namespace !== 'string' || (commitment.algorithm !== 'sha256' && commitment.algorithm !== 'keccak256')) throw new TypeError('context commitment is invalid')
    assertDigest(commitment.digest, 'context commitment digest')
    const key = `${commitment.namespace}|${commitment.algorithm}|${commitment.digest.toLowerCase()}`
    if (seen.has(key)) throw new TypeError('duplicate context commitments are not allowed')
    if (namespaces.has(commitment.namespace)) throw new TypeError('context commitment namespaces must be unique for a guarded Jupiter swap')
    seen.add(key)
    namespaces.add(commitment.namespace)
  }
}

function sameCommitment(left: ContextCommitment, right: ContextCommitment): boolean {
  return left.namespace === right.namespace && left.algorithm === right.algorithm && left.digest.toLowerCase() === right.digest.toLowerCase()
}

function clonePolicy(policy: JupiterGuardPolicy): JupiterGuardPolicy {
  return {
    ...policy,
    allowedProgramIds: [...policy.allowedProgramIds],
    ...(policy.allowedInputMints ? { allowedInputMints: [...policy.allowedInputMints] } : {}),
    ...(policy.allowedOutputMints ? { allowedOutputMints: [...policy.allowedOutputMints] } : {}),
    ...(policy.allowedAddressLookupTables ? { allowedAddressLookupTables: [...policy.allowedAddressLookupTables] } : {}),
  }
}

function responseJson(response: Response, service: string): Promise<unknown> {
  return response.json().catch(() => { throw new JupiterGuardedSwapError('UPSTREAM_INVALID_JSON', `${service} returned an invalid JSON response`) })
}

function readFailureMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback
  const error = isRecord(value.error) ? value.error : value
  return typeof error.message === 'string' && error.message.length <= 500 ? error.message : fallback
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
}

function assertPublicKey(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value) || decodeBase58(value).length !== 32) throw new TypeError(`${field} must be a 32-byte base58 public key`)
}

function readPublicKey(value: unknown, field: string): string {
  try { assertPublicKey(value, field); return value } catch { throw new JupiterGuardedSwapError('JUPITER_RESPONSE_INVALID', `${field} must be a 32-byte base58 public key`) }
}

function assertUnsigned(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError(`${field} must be an unsigned decimal string`)
}

function assertOptionalPublicKeyList(value: unknown, field: string): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length === 0 || value.length > 64 || new Set(value).size !== value.length) throw new TypeError(`${field} must be a non-empty unique public-key list`)
  value.forEach((entry, index) => assertPublicKey(entry, `${field}[${index}]`))
}

function readUnsigned(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new JupiterGuardedSwapError('JUPITER_RESPONSE_INVALID', `${field} must be an unsigned decimal string`)
  return value
}

function readInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new JupiterGuardedSwapError('JUPITER_RESPONSE_INVALID', `${field} must be an integer from ${min} through ${max}`)
  return Number(value)
}

function assertDigest(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError(`${field} must be a 32-byte hex digest`)
}

function readDigest(value: unknown, field: string): string {
  try { assertDigest(value, field); return value.toLowerCase() } catch { throw new JupiterGuardedSwapError('INSIGHT_SIMULATION_INVALID', `${field} must be a 32-byte hex digest`) }
}

function assertCanonicalBase64(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError(`${field} must be canonical base64`)
}

async function hashTransactionBytes(transactionBase64: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(decodeBase64(transactionBase64)))
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function assertSolanaSignature(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value) || decodeBase58(value).length !== 64) throw new TypeError('signature must be a 64-byte base58 Solana signature')
}

function decodeBase58(value: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const character of value) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) throw new TypeError('base58 is invalid')
    integer = integer * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (integer > 0n) { bytes.push(Number(integer & 0xffn)); integer >>= 8n }
  bytes.reverse()
  let zeroes = 0
  while (value[zeroes] === '1') zeroes += 1
  return Uint8Array.from([...new Array(zeroes).fill(0), ...bytes])
}

function decodeBase64(value: string): Uint8Array {
  assertCanonicalBase64(value, 'base64 value')
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function encodeBase58(value: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const byte of value) integer = (integer << 8n) | BigInt(byte)
  let encoded = ''
  while (integer > 0n) { encoded = alphabet[Number(integer % 58n)]! + encoded; integer /= 58n }
  let zeroes = 0
  while (zeroes < value.length && value[zeroes] === 0) zeroes += 1
  return '1'.repeat(zeroes) + encoded
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n
  for (let index = 0; index < 8; index += 1) value |= BigInt(bytes[offset + index]!) << BigInt(index * 8)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new JupiterGuardedSwapError('UPSTREAM_RESPONSE_INVALID', `${field} must be an object`)
  return value
}
