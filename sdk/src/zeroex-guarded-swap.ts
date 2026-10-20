import { PriorSealClient } from './client.js'
import {
  SOLANA_COMPUTE_BUDGET_PROGRAM,
  assertPreparedGuardedJupiterSwap,
  authorizeGuardedJupiterSwap,
  observeGuardedJupiterSwap,
  prepareGuardedJupiterSwap,
  reviewGuardedJupiterSwap,
  type GuardedJupiterSwapRequest,
  type GuardedJupiterSwapReview,
  type InsightSolanaSimulationClient,
  type JupiterGuardPolicy,
  type JupiterInstruction,
  type JupiterRouterBuild,
  type JupiterRouterBuildRequest,
  type JupiterTransactionCompiler,
  type PreparedGuardedJupiterSwap,
} from './jupiter-guarded-swap.js'
import type { ContextCommitment, ObservationResult, SolanaMessageWallet } from './types.js'

/** The raw-instruction endpoint; 0x never receives a wallet signing key. */
export const ZEROEX_SOLANA_SWAP_INSTRUCTIONS_URL = 'https://api.0x.org/solana/swap-instructions'

export type ZeroExInstruction = {
  accounts: Array<{ pubkey: number[]; is_signer: boolean; is_writable: boolean }>
  data: number[]
  program_id: number[]
}

export type ZeroExRouteLeg = {
  amountIn: string
  amountOut: string
  dexAddress: string
  dexLabel: string
  dexProgramId: string
  ppb: number
  tokenIn: string
  tokenOut: string
}

/**
 * A server-owned 0x sell-side fee. The recipient is an existing SPL token
 * account, never a caller-supplied wallet address. It is carried into the
 * exact 0x request and then bound to the PriorSeal authorization.
 */
export type ZeroExCommercialFeePolicy = {
  profileId: string
  tenantId: string
  inputMint: string
  feePpm: number
  recipientTokenAccount: string
  side: 'sell'
}

/** A portable commercial evidence record bound to the final authorization. */
export type ZeroExCommercialRecord = {
  schema: 'priorseal.zeroex-commercial-record.v1'
  provider: '0x'
  tenantId: string
  fee: null | {
    profileId: string
    side: 'sell'
    mint: string
    feePpm: number
    recipientTokenAccount: string
    expectedAmountAtomic: string
  }
  commitment: ContextCommitment
}

/** The provider response retained with a prepared package, excluding credentials. */
export type ZeroExRouterBuild = {
  inputMint: string
  outputMint: string
  inAmount: string
  amountOut: string
  minimumOutputAmount: string
  slippageBps: number
  instructions: JupiterInstruction[]
  /** Deployment-owned instructions prepended before the exact 0x sequence. */
  computeBudgetInstructions: JupiterInstruction[]
  addressLookupTableAddresses: string[]
  routePlan: ZeroExRouteLeg[]
  zid: string
  commercial: ZeroExCommercialRecord
}

/** A pinned 0x Ed25519 public key from the provider's response-signature registry. */
export type ZeroExResponseSigningKey = {
  kty: 'OKP'
  crv: 'Ed25519'
  kid: string
  x: string
}

/**
 * When set, every successful 0x build response must carry a fresh RFC 9421
 * response signature bound to this exact POST body. Keep both current and
 * announced-next keys here during a documented 0x key rotation.
 */
export type ZeroExResponseSignatureConfiguration = {
  trustedKeys: ZeroExResponseSigningKey[]
}

export type ZeroExRouterClientOptions = {
  apiKey: string
  /** Values are policy-bounded and form part of the exact authorized message. */
  computeBudget: { computeUnitLimit: number; computeUnitPriceMicroLamports: string }
  baseUrl?: string
  fetch?: typeof fetch
  responseSignature?: ZeroExResponseSignatureConfiguration
  /** Optional deployment-owned commercial fee; never accepts caller input. */
  commercialFee?: ZeroExCommercialFeePolicy
  now?: () => number
}

export type ZeroExRouterClient = {
  build(request: JupiterRouterBuildRequest, options?: { signal?: AbortSignal }): Promise<ZeroExCompilerBuild>
}

type ZeroExCompilerBuild = JupiterRouterBuild & { zeroExBuild: ZeroExRouterBuild }

/**
 * 0x does not supply compute-budget instructions. They are therefore explicit
 * deployment configuration, emitted before the immutable provider sequence and
 * checked by the existing Solana compute/fee policy.
 */
export type ZeroExGuardPolicy = JupiterGuardPolicy & {
  computeUnitLimit: number
  computeUnitPriceMicroLamports: string
  /** Optional tenant-bound monetization instruction, included in exact review. */
  commercialFee?: ZeroExCommercialFeePolicy
}

export type GuardedZeroExSwapRequest = GuardedJupiterSwapRequest

export type PreparedGuardedZeroExSwap = Omit<PreparedGuardedJupiterSwap, 'schema' | 'policy' | 'build'> & {
  schema: 'priorseal.zeroex-guarded-swap.v1'
  policy: ZeroExGuardPolicy
  build: ZeroExRouterBuild
  commercial: ZeroExCommercialRecord
}

export type GuardedZeroExSwapReview = Omit<GuardedJupiterSwapReview, 'schema' | 'output'> & {
  schema: 'priorseal.zeroex-guarded-swap-review.v1'
  output: { mint: string; minimumAmountAtomic: string; estimatedAmountAtomic: string }
  provider: { zid: string; routePlan: ZeroExRouteLeg[] }
  commercial: ZeroExCommercialRecord
}

export type PrepareGuardedZeroExSwapOptions = {
  router: ZeroExRouterClient
  compiler: JupiterTransactionCompiler
  insight: InsightSolanaSimulationClient
  policy: ZeroExGuardPolicy
  now?: () => number
  signal?: AbortSignal
}

export type AuthorizeGuardedZeroExSwapInput = {
  client: PriorSealClient
  prepared: PreparedGuardedZeroExSwap
  wallet: SolanaMessageWallet
  principal: { type: 'user' | 'organization'; id: string }
  agentId: string
  audience?: string
  now?: () => number
  signal?: AbortSignal
}

/** Validates a non-secret, rotation-safe 0x response-signing key set. */
export function parseZeroExResponseSignatureConfiguration(value: unknown): ZeroExResponseSignatureConfiguration {
  const record = asRecord(value, '0x response-signature configuration')
  if (Object.keys(record).length !== 1 || !Array.isArray(record.trustedKeys) || record.trustedKeys.length === 0 || record.trustedKeys.length > 8) {
    throw new TypeError('0x response-signature configuration must contain 1 through 8 trustedKeys')
  }
  const trustedKeys = record.trustedKeys.map((entry, index) => {
    const key = asRecord(entry, `0x response-signature trustedKeys[${index}]`)
    const allowed = new Set(['kty', 'crv', 'kid', 'x'])
    if (Object.keys(key).some(name => !allowed.has(name)) || key.kty !== 'OKP' || key.crv !== 'Ed25519' || typeof key.kid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key.kid) || typeof key.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.x) || base64UrlBytes(key.x).length !== 32) {
      throw new TypeError(`0x response-signature trustedKeys[${index}] must be an Ed25519 public JWK`)
    }
    return { kty: 'OKP' as const, crv: 'Ed25519' as const, kid: key.kid, x: key.x }
  })
  if (new Set(trustedKeys.map(key => key.kid)).size !== trustedKeys.length) throw new TypeError('0x response-signature trustedKeys must not repeat a kid')
  return { trustedKeys }
}

/** Creates a strict, server-side client for 0x's Solana raw-instruction API. */
export function createZeroExRouterClient(options: ZeroExRouterClientOptions): ZeroExRouterClient {
  const apiKey = requiredSecret(options.apiKey, '0x API key')
  const computeBudget = assertComputeBudgetConfiguration(options.computeBudget)
  const endpointUrl = new URL(options.baseUrl ?? ZEROEX_SOLANA_SWAP_INSTRUCTIONS_URL)
  if (endpointUrl.protocol !== 'https:' || endpointUrl.username || endpointUrl.password) throw new TypeError('0x Solana API baseUrl must use HTTPS without embedded credentials')
  const endpoint = endpointUrl.toString().replace(/\/$/, '')
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) throw new TypeError('0x Solana router client requires a Fetch-compatible implementation')
  const responseSignature = options.responseSignature ? parseZeroExResponseSignatureConfiguration(options.responseSignature) : undefined
  const commercialFee = options.commercialFee ? assertCommercialFeePolicy(options.commercialFee) : undefined
  const now = options.now ?? (() => Date.now())
  return {
    async build(request, requestOptions = {}) {
      assertRequestAmount(request.amount)
      const amountIn = Number(request.amount)
      const commercial = await commercialRecord(request, commercialFee)
      const requestBody = JSON.stringify({
        token_in: request.inputMint, token_out: request.outputMint, amount_in: amountIn, taker: request.taker, slippage_bps: request.slippageBps, transaction_version: 'v0',
        ...(commercialFee ? { swap_fee_ppm: commercialFee.feePpm, swap_fee_recipient: commercialFee.recipientTokenAccount, swap_fee_side: commercialFee.side } : {}),
      })
      const requestBytes = new TextEncoder().encode(requestBody)
      const requestContentDigest = responseSignature ? await contentDigest(requestBytes) : undefined
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json', 'content-type': 'application/json', '0x-api-key': apiKey, '0x-version': 'v2',
          ...(responseSignature ? { 'accept-signature': 'sig=()', 'content-digest': requestContentDigest! } : {}),
        },
        body: requestBody,
        signal: requestOptions.signal,
        redirect: 'error',
      })
      const parsed = await responseJson(response, '0x Solana Swap API')
      if (!response.ok) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_REJECTED', failureMessage(parsed.body, '0x Solana Swap API rejected the swap request'))
      if (responseSignature) await verifyZeroExResponseSignature({ response, responseBytes: parsed.bytes, request: { method: 'POST', url: endpoint, body: requestBytes, contentDigest: requestContentDigest! }, configuration: responseSignature, now })
      const build = parseZeroExBuild(parsed.body, request, computeBudget, commercial)
      return toCompilerBuild(build)
    },
  }
}

/** Builds, simulates, and authorizes a 0x-routed transaction without custody. */
export async function prepareGuardedZeroExSwap(request: GuardedZeroExSwapRequest, options: PrepareGuardedZeroExSwapOptions): Promise<PreparedGuardedZeroExSwap> {
  assertZeroExPolicy(options.policy)
  if ((request.contextCommitments ?? []).some(commitment => commitment.namespace === 'priorseal.zeroex-commercial-record.v1')) {
    throw new ZeroExGuardedSwapError('ZEROEX_COMMERCIAL_COMMITMENT_RESERVED', 'The 0x commercial-record commitment namespace is reserved for deployment-owned billing evidence')
  }
  const commercial = await commercialRecord(request, options.policy.commercialFee)
  const requestWithCommercialCommitment: GuardedZeroExSwapRequest = {
    ...request,
    contextCommitments: [...(request.contextCommitments ?? []), commercial.commitment],
  }
  const prepared = await prepareGuardedJupiterSwap(requestWithCommercialCommitment, {
    router: options.router,
    compiler: options.compiler,
    insight: options.insight,
    policy: toJupiterPolicy(options.policy),
    ...(options.now ? { now: options.now } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const build = (prepared.build as Partial<ZeroExCompilerBuild>).zeroExBuild
  if (!build) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', '0x router did not return a retained build record')
  if (!sameCommercialRecord(build.commercial, commercial)) throw new ZeroExGuardedSwapError('ZEROEX_COMMERCIAL_FEE_MISMATCH', '0x build commercial terms differ from deployment policy')
  return { ...prepared, schema: 'priorseal.zeroex-guarded-swap.v1', policy: cloneZeroExPolicy(options.policy), build, commercial }
}

/** Revalidates all provider, compiler, simulation, and authorization bindings. */
export async function assertPreparedGuardedZeroExSwap(prepared: PreparedGuardedZeroExSwap, now?: () => number): Promise<void> {
  if (!prepared || prepared.schema !== 'priorseal.zeroex-guarded-swap.v1') throw new TypeError('prepared guarded 0x swap is invalid')
  assertZeroExPolicy(prepared.policy)
  const expectedCommercial = await commercialRecord(prepared.request, prepared.policy.commercialFee)
  assertZeroExBuild(prepared.build, prepared.request, prepared.policy, expectedCommercial)
  if (!sameCommercialRecord(prepared.commercial, expectedCommercial)) throw new ZeroExGuardedSwapError('ZEROEX_COMMERCIAL_FEE_MISMATCH', 'The prepared commercial record does not match deployment policy')
  const commercialCommitments = (prepared.request.contextCommitments ?? []).filter(commitment => commitment.namespace === prepared.commercial.commitment.namespace)
  if (commercialCommitments.length !== 1 || !sameCommitment(commercialCommitments[0]!, prepared.commercial.commitment)) throw new ZeroExGuardedSwapError('ZEROEX_COMMERCIAL_COMMITMENT_MISMATCH', 'The prepared authorization does not bind the commercial record')
  await assertPreparedGuardedJupiterSwap(toJupiterPrepared(prepared), now)
}

export async function reviewGuardedZeroExSwap(prepared: PreparedGuardedZeroExSwap, now?: () => number): Promise<GuardedZeroExSwapReview> {
  await assertPreparedGuardedZeroExSwap(prepared, now)
  const review = await reviewGuardedJupiterSwap(toJupiterPrepared(prepared), now)
  return {
    ...review,
    schema: 'priorseal.zeroex-guarded-swap-review.v1',
    output: { mint: prepared.request.outputMint, minimumAmountAtomic: prepared.build.minimumOutputAmount, estimatedAmountAtomic: prepared.build.amountOut },
    provider: { zid: prepared.build.zid, routePlan: prepared.build.routePlan.map((leg) => ({ ...leg })) },
    commercial: structuredClone(prepared.commercial),
  }
}

export function authorizeGuardedZeroExSwap(input: AuthorizeGuardedZeroExSwapInput): ReturnType<PriorSealClient['authorizeWithSolanaWallet']> {
  return authorizeGuardedJupiterSwap({ ...input, prepared: toJupiterPrepared(input.prepared) })
}

export function observeGuardedZeroExSwap(input: { client: PriorSealClient; authorizationId: string; signature: string; confirmations?: number; signal?: AbortSignal }): Promise<ObservationResult> {
  return observeGuardedJupiterSwap(input)
}

export class ZeroExGuardedSwapError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZeroExGuardedSwapError'
    this.code = code
  }
}

function toJupiterPrepared(prepared: PreparedGuardedZeroExSwap): PreparedGuardedJupiterSwap {
  return {
    ...prepared,
    schema: 'priorseal.jupiter-guarded-swap.v1',
    policy: toJupiterPolicy(prepared.policy),
    build: toCompilerBuild(prepared.build),
  }
}

function toJupiterPolicy(policy: ZeroExGuardPolicy): JupiterGuardPolicy {
  const { computeUnitLimit: _limit, computeUnitPriceMicroLamports: _price, commercialFee: _commercialFee, ...jupiterPolicy } = policy
  return jupiterPolicy
}

function toCompilerBuild(build: ZeroExRouterBuild): ZeroExCompilerBuild {
  if (build.instructions.length === 0) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', '0x returned no swap instructions')
  const [swapInstruction, ...otherInstructions] = build.instructions
  return {
    inputMint: build.inputMint,
    outputMint: build.outputMint,
    inAmount: build.inAmount,
    otherAmountThreshold: build.minimumOutputAmount,
    swapMode: 'ExactIn',
    slippageBps: build.slippageBps,
    computeBudgetInstructions: build.computeBudgetInstructions,
    setupInstructions: [],
    swapInstruction: swapInstruction!,
    cleanupInstruction: null,
    otherInstructions,
    tipInstruction: null,
    addressLookupTableAddresses: build.addressLookupTableAddresses,
    zeroExBuild: build,
  }
}

function parseZeroExBuild(value: unknown, request: JupiterRouterBuildRequest, computeBudget: ZeroExRouterClientOptions['computeBudget'], commercial: ZeroExCommercialRecord): ZeroExRouterBuild {
  const record = asRecord(value, '0x Solana Swap API response')
  const minimumOutputAmount = atomic(record.min_amount_out, '0x min_amount_out')
  const amountOut = atomic(record.amount_out, '0x amount_out')
  if (minimumOutputAmount === '0') throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', '0x returned a zero minimum output')
  const instructions = instructionList(record.instructions, '0x instructions')
  const addressLookupTableAddresses = publicKeyList(record.address_lookup_tables, '0x address_lookup_tables', 32)
  const routePlan = routeList(record.route_plan)
  const zid = typeof record.zid === 'string' && /^[0-9a-fA-F]{24}$/.test(record.zid) ? record.zid.toLowerCase() : fail('ZEROEX_BUILD_INVALID', '0x zid is invalid')
  if (record.sponsor !== undefined && record.sponsor !== null) throw new ZeroExGuardedSwapError('ZEROEX_SPONSOR_FORBIDDEN', '0x-sponsored transactions are outside the single-wallet guarded-swap profile')
  return {
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount: request.amount,
    amountOut,
    minimumOutputAmount,
    slippageBps: request.slippageBps,
    instructions,
    computeBudgetInstructions: [computeUnitLimitInstruction(computeBudget.computeUnitLimit), computeUnitPriceInstruction(computeBudget.computeUnitPriceMicroLamports)],
    addressLookupTableAddresses,
    routePlan,
    zid,
    commercial,
  }
}

function assertZeroExBuild(build: ZeroExRouterBuild, request: GuardedZeroExSwapRequest, policy: ZeroExGuardPolicy, commercial: ZeroExCommercialRecord): void {
  if (!build || typeof build !== 'object') throw new TypeError('0x build is invalid')
  if (build.inputMint !== request.inputMint || build.outputMint !== request.outputMint || build.inAmount !== request.amount || build.slippageBps !== request.slippageBps) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_MISMATCH', '0x build does not match the guarded request')
  atomic(build.amountOut, '0x amountOut')
  const minimumOutputAmount = atomic(build.minimumOutputAmount, '0x minimumOutputAmount')
  if (minimumOutputAmount === '0') throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', '0x minimum output must be positive')
  if (request.minimumOutputAmountAtomic !== undefined && BigInt(minimumOutputAmount) < BigInt(request.minimumOutputAmountAtomic)) throw new ZeroExGuardedSwapError('OUTPUT_AMOUNT_BELOW_REQUEST_MINIMUM', '0x minimum output is below the requested output floor')
  assertNormalizedInstructionList(build.instructions, '0x build instructions')
  const expectedCompute = [computeUnitLimitInstruction(policy.computeUnitLimit), computeUnitPriceInstruction(policy.computeUnitPriceMicroLamports)]
  if (!sameInstructions(build.computeBudgetInstructions, expectedCompute)) throw new ZeroExGuardedSwapError('ZEROEX_COMPUTE_BUDGET_MISMATCH', '0x build compute-budget instructions differ from deployment policy')
  publicKeyList(build.addressLookupTableAddresses, '0x build address lookup tables', 32)
  routeList(build.routePlan)
  if (!/^[0-9a-f]{24}$/.test(build.zid)) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', '0x zid is invalid')
  if (!sameCommercialRecord(build.commercial, commercial)) throw new ZeroExGuardedSwapError('ZEROEX_COMMERCIAL_FEE_MISMATCH', '0x build commercial terms do not match deployment policy')
}

function assertZeroExPolicy(policy: ZeroExGuardPolicy): void {
  if (!policy || typeof policy !== 'object') throw new TypeError('0x guard policy is required')
  const compute = assertComputeBudgetConfiguration(policy)
  if (policy.maxComputeUnitLimit === undefined || policy.maxComputeUnitLimit < compute.computeUnitLimit) throw new TypeError('0x policy maxComputeUnitLimit must cap the configured computeUnitLimit')
  if (policy.maxComputeUnitPriceMicroLamports === undefined || BigInt(policy.maxComputeUnitPriceMicroLamports) < BigInt(compute.computeUnitPriceMicroLamports)) throw new TypeError('0x policy maxComputeUnitPriceMicroLamports must cap the configured compute-unit price')
  const priorityFee = (BigInt(compute.computeUnitLimit) * BigInt(compute.computeUnitPriceMicroLamports) + 999_999n) / 1_000_000n
  if (policy.maxPriorityFeeLamports === undefined || BigInt(policy.maxPriorityFeeLamports) < priorityFee) throw new TypeError('0x policy maxPriorityFeeLamports must cap the configured priority fee')
  if (policy.commercialFee) assertCommercialFeePolicy(policy.commercialFee)
}

function assertComputeBudgetConfiguration(value: { computeUnitLimit: number; computeUnitPriceMicroLamports: string }): { computeUnitLimit: number; computeUnitPriceMicroLamports: string } {
  if (!value || !Number.isSafeInteger(value.computeUnitLimit) || value.computeUnitLimit < 1 || value.computeUnitLimit > 1_400_000) throw new TypeError('computeUnitLimit must be an integer from 1 through 1400000')
  atomic(value.computeUnitPriceMicroLamports, 'computeUnitPriceMicroLamports')
  return { computeUnitLimit: value.computeUnitLimit, computeUnitPriceMicroLamports: value.computeUnitPriceMicroLamports }
}

function cloneZeroExPolicy(policy: ZeroExGuardPolicy): ZeroExGuardPolicy {
  return {
    ...policy,
    ...(policy.commercialFee ? { commercialFee: { ...policy.commercialFee } } : {}),
    allowedInputMints: policy.allowedInputMints ? [...policy.allowedInputMints] : undefined,
    allowedOutputMints: policy.allowedOutputMints ? [...policy.allowedOutputMints] : undefined,
    allowedProgramIds: [...policy.allowedProgramIds],
    allowedAddressLookupTables: policy.allowedAddressLookupTables ? [...policy.allowedAddressLookupTables] : undefined,
  }
}

function assertCommercialFeePolicy(value: ZeroExCommercialFeePolicy): ZeroExCommercialFeePolicy {
  if (!value || typeof value !== 'object' || typeof value.profileId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.profileId) || typeof value.tenantId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.tenantId)) {
    throw new TypeError('0x commercial fee profile and tenant identifiers are invalid')
  }
  base58String(value.inputMint, '0x commercial fee inputMint')
  base58String(value.recipientTokenAccount, '0x commercial fee recipientTokenAccount')
  if (value.side !== 'sell' || !Number.isSafeInteger(value.feePpm) || value.feePpm < 1 || value.feePpm > 100_000) {
    throw new TypeError('0x commercial fee must be a sell-side rate from 1 through 100000 ppm')
  }
  return { profileId: value.profileId, tenantId: value.tenantId, inputMint: value.inputMint, feePpm: value.feePpm, recipientTokenAccount: value.recipientTokenAccount, side: 'sell' }
}

async function commercialRecord(request: Pick<GuardedZeroExSwapRequest, 'inputMint' | 'amount'>, configuredFee: ZeroExCommercialFeePolicy | undefined): Promise<ZeroExCommercialRecord> {
  const feePolicy = configuredFee ? assertCommercialFeePolicy(configuredFee) : undefined
  if (feePolicy && request.inputMint !== feePolicy.inputMint) {
    throw new ZeroExGuardedSwapError('ZEROEX_COMMERCIAL_FEE_ASSET_MISMATCH', 'The deployment fee profile does not permit this input mint')
  }
  const fee = feePolicy ? {
    profileId: feePolicy.profileId,
    side: 'sell' as const,
    mint: feePolicy.inputMint,
    feePpm: feePolicy.feePpm,
    recipientTokenAccount: feePolicy.recipientTokenAccount,
    expectedAmountAtomic: ((BigInt(request.amount) * BigInt(feePolicy.feePpm) + 999_999n) / 1_000_000n).toString(),
  } : null
  const terms = { schema: 'priorseal.zeroex-commercial-record.v1' as const, provider: '0x' as const, tenantId: feePolicy?.tenantId ?? 'public', fee }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(terms)))
  return { ...terms, commitment: { namespace: 'priorseal.zeroex-commercial-record.v1', algorithm: 'sha256', digest: `0x${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}` } }
}

function sameCommercialRecord(left: unknown, right: ZeroExCommercialRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameCommitment(left: ContextCommitment, right: ContextCommitment): boolean {
  return left.namespace === right.namespace && left.algorithm === right.algorithm && left.digest === right.digest
}

function computeUnitLimitInstruction(limit: number): JupiterInstruction {
  const data = new Uint8Array(5)
  data[0] = 2
  new DataView(data.buffer).setUint32(1, limit, true)
  return { programId: SOLANA_COMPUTE_BUDGET_PROGRAM, accounts: [], data: base64(data) }
}

function computeUnitPriceInstruction(price: string): JupiterInstruction {
  const value = BigInt(price)
  const data = new Uint8Array(9)
  data[0] = 3
  const view = new DataView(data.buffer)
  view.setUint32(1, Number(value & 0xffff_ffffn), true)
  view.setUint32(5, Number(value >> 32n), true)
  return { programId: SOLANA_COMPUTE_BUDGET_PROGRAM, accounts: [], data: base64(data) }
}

function instructionList(value: unknown, label: string): JupiterInstruction[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} must be a non-empty instruction array`)
  return value.map((entry, index) => {
    const record = asRecord(entry, `${label}[${index}]`)
    if (!Array.isArray(record.accounts) || record.accounts.length > 256) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label}[${index}].accounts is invalid`)
    return {
      programId: base58PublicKey(record.program_id, `${label}[${index}].program_id`),
      accounts: record.accounts.map((account, accountIndex) => {
        const item = asRecord(account, `${label}[${index}].accounts[${accountIndex}]`)
        if (typeof item.is_signer !== 'boolean' || typeof item.is_writable !== 'boolean') throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label}[${index}].accounts[${accountIndex}] flags are invalid`)
        return { pubkey: base58PublicKey(item.pubkey, `${label}[${index}].accounts[${accountIndex}].pubkey`), isSigner: item.is_signer, isWritable: item.is_writable }
      }),
      data: base64(byteArray(record.data, `${label}[${index}].data`, 4096)),
    }
  })
}

function routeList(value: unknown): ZeroExRouteLeg[] {
  if (!Array.isArray(value) || value.length > 32) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', '0x route_plan is invalid')
  return value.map((entry, index) => {
    const record = asRecord(entry, `0x route_plan[${index}]`)
    const ppbValue = record.ppb
    if (typeof ppbValue !== 'number' || !Number.isSafeInteger(ppbValue) || ppbValue < 0 || ppbValue > 1_000_000_000) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `0x route_plan[${index}].ppb is invalid`)
    const ppb = Number(ppbValue)
    return {
      amountIn: atomic(record.amount_in, `0x route_plan[${index}].amount_in`), amountOut: atomic(record.amount_out, `0x route_plan[${index}].amount_out`),
      dexAddress: base58String(record.dex_address, `0x route_plan[${index}].dex_address`), dexLabel: boundedString(record.dex_label, `0x route_plan[${index}].dex_label`, 128),
      dexProgramId: base58String(record.dex_program_id, `0x route_plan[${index}].dex_program_id`), ppb,
      tokenIn: base58String(record.token_in, `0x route_plan[${index}].token_in`), tokenOut: base58String(record.token_out, `0x route_plan[${index}].token_out`),
    }
  })
}

function publicKeyList(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} is invalid`)
  const keys = value.map((entry, index) => base58String(entry, `${label}[${index}]`))
  if (new Set(keys).size !== keys.length) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} must not contain duplicates`)
  return keys
}

function base58PublicKey(value: unknown, label: string): string {
  const bytes = byteArray(value, label, 32)
  if (bytes.length !== 32) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} must be a 32-byte public key`)
  return encodeBase58(bytes)
}

function base58String(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} is invalid`)
  if (decodeBase58(value).length !== 32) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} must be a 32-byte public key`)
  return value
}

function assertNormalizedInstructionList(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} must be a non-empty instruction array`)
  value.forEach((entry, index) => {
    const record = asRecord(entry, `${label}[${index}]`)
    base58String(record.programId, `${label}[${index}].programId`)
    if (!Array.isArray(record.accounts) || record.accounts.length > 256) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label}[${index}].accounts is invalid`)
    record.accounts.forEach((account, accountIndex) => {
      const item = asRecord(account, `${label}[${index}].accounts[${accountIndex}]`)
      base58String(item.pubkey, `${label}[${index}].accounts[${accountIndex}].pubkey`)
      if (typeof item.isSigner !== 'boolean' || typeof item.isWritable !== 'boolean') throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label}[${index}].accounts[${accountIndex}] flags are invalid`)
    })
    if (typeof record.data !== 'string' || record.data.length > 5_464 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.data)) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label}[${index}].data is invalid`)
  })
}

function byteArray(value: unknown, label: string, max: number): Uint8Array {
  if (!Array.isArray(value) || value.length === 0 || value.length > max || value.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} must be a byte array`)
  return Uint8Array.from(value)
}

function atomic(value: unknown, label: string): string {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} must be a safe non-negative atomic integer`)
}

function assertRequestAmount(value: string): void {
  if (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZeroExGuardedSwapError('ZEROEX_AMOUNT_UNSAFE', '0x guarded swaps currently require a positive atomic input amount within JavaScript safe-integer range')
}

function sameInstructions(left: JupiterInstruction[], right: JupiterInstruction[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} must be an object`)
  return value as Record<string, unknown>
}

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', `${label} is invalid`)
  return value
}

function requiredSecret(value: string, label: string): string {
  const secret = value.trim()
  if (!secret) throw new TypeError(`${label} is required`)
  return secret
}

function fail(code: string, message: string): never { throw new ZeroExGuardedSwapError(code, message) }

async function responseJson(response: Response, label: string): Promise<{ body: unknown; bytes: Uint8Array }> {
  const type = response.headers.get('content-type') ?? ''
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > 1_000_000) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_TOO_LARGE', `${label} response is too large`)
  if (!/^application\/json(?:;|$)/i.test(type)) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_INVALID', `${label} returned an invalid JSON response (HTTP ${response.status}, content-type ${type || 'missing'})`)
  try { return { body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown, bytes } } catch { throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_INVALID', `${label} returned invalid JSON`) }
}

type ParsedZeroExSignatureInput = {
  components: Array<{ name: string; request: boolean }>
  created: number
  keyId: string
  signatureParams: string
}

async function verifyZeroExResponseSignature(input: {
  response: Response
  responseBytes: Uint8Array
  request: { method: 'POST'; url: string; body: Uint8Array; contentDigest: string }
  configuration: ZeroExResponseSignatureConfiguration
  now: () => number
}): Promise<void> {
  const signatureInput = parseZeroExSignatureInput(requiredHeader(input.response, 'signature-input'))
  const signature = parseSignature(requiredHeader(input.response, 'signature'))
  const responseDigest = requiredHeader(input.response, 'content-digest')
  const expectedDigest = await contentDigest(input.responseBytes)
  if (!constantTimeEqual(parseContentDigest(responseDigest), parseContentDigest(expectedDigest))) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x response Content-Digest does not match its body')
  if (!constantTimeEqual(parseContentDigest(input.request.contentDigest), await sha256(input.request.body))) {
    throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x request Content-Digest was not bound to the request body')
  }
  const currentSeconds = Math.floor(input.now() / 1_000)
  if (Math.abs(currentSeconds - signatureInput.created) > 60) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_STALE', '0x response signature is older than the 60-second freshness limit')
  const key = input.configuration.trustedKeys.find(candidate => candidate.kid === signatureInput.keyId)
  if (!key) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_UNTRUSTED_KEY', '0x response uses an untrusted signing key')
  const base = signatureBase(signatureInput, input.response, input.request)
  try {
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'Ed25519' }, false, ['verify'])
    if (!await crypto.subtle.verify({ name: 'Ed25519' }, cryptoKey, webCryptoBytes(signature), webCryptoBytes(new TextEncoder().encode(base)))) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x response signature is invalid')
  } catch (error) {
    if (error instanceof ZeroExGuardedSwapError) throw error
    throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x response signature could not be verified')
  }
}

function parseZeroExSignatureInput(value: string): ParsedZeroExSignatureInput {
  const match = /^sig=\(([^)]*)\);created=(0|[1-9][0-9]*);keyid="([A-Za-z0-9][A-Za-z0-9._:-]{0,127})";alg="ed25519";tag="0x-swap-api"$/.exec(value)
  if (!match) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Signature-Input is malformed or uses an unsupported algorithm')
  const components = match[1]!.split(' ').map(component => {
    const componentMatch = /^"(@(?:status|method|authority|path|query)|content-(?:type|digest))"(;req)?$/.exec(component)
    if (!componentMatch) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Signature-Input contains an unsupported covered component')
    return { name: componentMatch[1]!, request: Boolean(componentMatch[2]) }
  })
  const required = ['@status', 'content-type', 'content-digest', '@method;req', '@authority;req', '@path;req', '@query;req', 'content-digest;req']
  const actual = components.map(component => `${component.name}${component.request ? ';req' : ''}`)
  if (components.length !== required.length || new Set(actual).size !== actual.length || required.some(component => !actual.includes(component))) {
    throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Signature-Input does not cover the required request and response components')
  }
  const created = Number(match[2])
  if (!Number.isSafeInteger(created)) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Signature-Input created time is invalid')
  return { components, created, keyId: match[3]!, signatureParams: value.slice('sig='.length) }
}

function signatureBase(input: ParsedZeroExSignatureInput, response: Response, request: { method: 'POST'; url: string; body: Uint8Array; contentDigest: string }): string {
  const url = new URL(request.url)
  const values = input.components.map(component => {
    const componentName = `"${component.name}"${component.request ? ';req' : ''}`
    const value = component.request
      ? requestComponent(component.name, request, url)
      : responseComponent(component.name, response)
    return `${componentName}: ${value}`
  })
  return [...values, `"@signature-params": ${input.signatureParams}`].join('\n')
}

function requestComponent(component: string, request: { method: 'POST'; url: string; body: Uint8Array; contentDigest: string }, url: URL): string {
  switch (component) {
    case '@method': return request.method.toLowerCase()
    case '@authority': return url.host.toLowerCase()
    case '@path': return url.pathname || '/'
    case '@query': return url.search
    case 'content-digest': return request.contentDigest
    default: throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Signature-Input requests an unsupported request component')
  }
}

function responseComponent(component: string, response: Response): string {
  if (component === '@status') return String(response.status)
  if (component === 'content-type' || component === 'content-digest') return requiredHeader(response, component)
  throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Signature-Input requests an unsupported response component')
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name)
  if (!value || /[\r\n]/.test(value)) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', `0x response is missing a valid ${name} header`)
  return value
}

function parseSignature(value: string): Uint8Array {
  const match = /^sig=:([A-Za-z0-9+/]{86}==):$/.exec(value)
  if (!match) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Signature header is malformed')
  const signature = base64Bytes(match[1]!)
  if (signature.length !== 64) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Signature has an invalid length')
  return signature
}

function parseContentDigest(value: string): Uint8Array {
  const match = /^sha-256=:([A-Za-z0-9+/]{43}=):$/.exec(value)
  if (!match) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Content-Digest header is malformed')
  const digest = base64Bytes(match[1]!)
  if (digest.length !== 32) throw new ZeroExGuardedSwapError('ZEROEX_RESPONSE_SIGNATURE_INVALID', '0x Content-Digest has an invalid length')
  return digest
}

async function contentDigest(bytes: Uint8Array): Promise<string> {
  return `sha-256=:${base64(await sha256(bytes))}:`
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', webCryptoBytes(bytes)))
}

function webCryptoBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!
  return difference === 0
}

function failureMessage(value: unknown, fallback: string): string {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).message === 'string'
    ? (value as Record<string, unknown>).message as string
    : fallback
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64Bytes(value: string): Uint8Array {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    throw new TypeError('invalid base64 value')
  }
}

function base64UrlBytes(value: string): Uint8Array {
  return base64Bytes(`${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - value.length % 4) % 4)}`)
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let index = 0; index < digits.length; index += 1) {
      const value = digits[index]! * 256 + carry
      digits[index] = value % 58
      carry = Math.floor(value / 58)
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58) }
  }
  let encoded = ''
  let leadingZeroes = 0
  for (const byte of bytes) { if (byte !== 0) break; leadingZeroes += 1 }
  encoded = '1'.repeat(leadingZeroes)
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (index === 0 && digits[index] === 0 && leadingZeroes === bytes.length) continue
    encoded += alphabet[digits[index]!]!
  }
  return encoded
}

function decodeBase58(value: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const character of value) {
    const index = alphabet.indexOf(character)
    if (index < 0) throw new ZeroExGuardedSwapError('ZEROEX_BUILD_INVALID', 'Invalid base58 value')
    integer = integer * 58n + BigInt(index)
  }
  const bytes: number[] = []
  while (integer > 0n) { bytes.push(Number(integer & 0xffn)); integer >>= 8n }
  bytes.reverse()
  let leadingZeroes = 0
  while (leadingZeroes < value.length && value[leadingZeroes] === '1') leadingZeroes += 1
  return Uint8Array.from([...Array(leadingZeroes).fill(0), ...bytes])
}
