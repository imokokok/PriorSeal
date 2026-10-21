import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import {
  ZeroExGuardedSwapError,
  assertPreparedGuardedZeroExSwap,
  agentProposalCommitment,
  createInsightSolanaSimulationClient,
  createZeroExRouterClient,
  hashSolanaTransactionMessage,
  prepareGuardedZeroExSwap,
  reviewGuardedZeroExSwap,
  type GuardedZeroExSwapRequest,
  type AgentProposal,
  type ContextCommitment,
  type JupiterTransactionCompiler,
  type PreparedGuardedZeroExSwap,
  type ZeroExGuardPolicy,
  type ZeroExResponseSignatureConfiguration,
} from 'priorseal-sdk'
import { createJupiterV0Compiler } from '../jupiter/guarded-swap-service.mjs'
import { resolveGuardedZeroExTenantPolicy, type GuardedZeroExTenantPolicySet } from './tenant-policy.mjs'
import { canonicalize, hashJson } from '../../domain/hashing.mjs'
import { buildZeroExCommercialLedgerEvent, type ZeroExCommercialLedgerEvent } from '../../domain/zeroex-commercial-ledger.mjs'
import type { Authorization, AuthorizationAcceptance } from '../../domain/authorization.mjs'

export type GuardedZeroExDeploymentPolicy = Omit<ZeroExGuardPolicy, 'feePayer' | 'commercialFee'>
export type GuardedZeroExPrepareInput = Omit<GuardedZeroExSwapRequest, 'intentId'> & {
  intentId?: string
  /** A caller-retained disclosure; only its server-computed commitment enters the exact intent. */
  agentProposal?: AgentProposal
}

export type GuardedZeroExSwapService = {
  prepare(input: GuardedZeroExPrepareInput, options?: { signal?: AbortSignal; agentAccountId?: string }): Promise<{ prepared: PreparedGuardedZeroExSwap; review: Awaited<ReturnType<typeof reviewGuardedZeroExSwap>>; tenantId: string }>
  submit(input: { authorizationId: string; prepared: PreparedGuardedZeroExSwap; signedTransactionBase64: string }, options?: { signal?: AbortSignal }): Promise<{ signature: string; submission: 'SUBMITTED' | 'UNKNOWN' }>
}

export type GuardedZeroExAuthorizationRecord = {
  authorization: Authorization
  acceptance: AuthorizationAcceptance
  boundTxHash: string | null
  uses: number
  status: string
}

export type GuardedZeroExAuthorizationStore = {
  getAuthorization(id: string): Promise<GuardedZeroExAuthorizationRecord | null | undefined>
  claimAuthorization(id: string, txHash: string): Promise<{ ok: boolean; code?: string; record?: GuardedZeroExAuthorizationRecord }>
}

export type GuardedZeroExCommercialLedger = {
  appendZeroExCommercialLedgerEvent(value: ZeroExCommercialLedgerEvent): Promise<ZeroExCommercialLedgerEvent>
}

export type GuardedZeroExSwapServiceOptions = {
  zeroExApiKey: string
  insightApiKey: string
  rpcUrl: string
  policy: GuardedZeroExDeploymentPolicy
  tenantPolicies?: GuardedZeroExTenantPolicySet
  responseSignature: ZeroExResponseSignatureConfiguration
  zeroExBaseUrl?: string
  insightBaseUrl?: string
  fetch?: typeof fetch
  now?: () => number
  compiler?: JupiterTransactionCompiler
  connection?: Pick<Connection, 'getLatestBlockhash' | 'getAddressLookupTable' | 'getParsedAccountInfo' | 'sendRawTransaction'>
  authorizationStore: GuardedZeroExAuthorizationStore
  /** Required for a fee-bearing relay; prevents a non-auditable broadcast. */
  commercialLedger?: GuardedZeroExCommercialLedger
}

/**
 * Server-only 0x preparation and relay. The 0x and Insight keys never leave
 * this boundary; the wallet signs both its PriorSeal authority and unchanged
 * prepared transaction bytes.
 */
export function createGuardedZeroExSwapService(options: GuardedZeroExSwapServiceOptions): GuardedZeroExSwapService {
  const apiKey = requiredSecret(options.zeroExApiKey, 'ZEROEX_API_KEY')
  const insightKey = requiredSecret(options.insightApiKey, 'INSIGHT_API_KEY')
  const policy = assertDeploymentPolicy(options.policy)
  const connection = options.connection ?? new Connection(assertHttpsUrl(options.rpcUrl), 'confirmed')
  const compiler = bindCompilerToWireMessage(options.compiler ?? createJupiterV0Compiler({ rpcUrl: options.rpcUrl, connection }))
  const routerFor = (effectivePolicy: ZeroExGuardPolicy) => createZeroExRouterClient({
    apiKey,
    computeBudget: { computeUnitLimit: effectivePolicy.computeUnitLimit, computeUnitPriceMicroLamports: effectivePolicy.computeUnitPriceMicroLamports },
    ...(effectivePolicy.commercialFee ? { commercialFee: effectivePolicy.commercialFee } : {}),
    responseSignature: options.responseSignature,
    ...(options.zeroExBaseUrl ? { baseUrl: options.zeroExBaseUrl } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  })
  const insight = createInsightSolanaSimulationClient({ apiKey: insightKey, ...(options.insightBaseUrl ? { baseUrl: options.insightBaseUrl } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) })
  const now = options.now ?? (() => Date.now())
  return {
    async prepare(input, requestOptions = {}) {
      const intentId = input.intentId ?? `zxs_${crypto.randomUUID().replaceAll('-', '')}`
      const { agentProposal, ...requestInput } = input
      const contextCommitments: ContextCommitment[] = [
        ...(requestInput.contextCommitments ?? []),
        ...(agentProposal ? [await agentProposalCommitment(agentProposal)] : []),
      ]
      const request: GuardedZeroExSwapRequest = {
        ...requestInput,
        intentId,
        ...(contextCommitments.length ? { contextCommitments } : {}),
      }
      const tenant = resolveGuardedZeroExTenantPolicy(policy, options.tenantPolicies, requestOptions.agentAccountId)
      const effectivePolicy: ZeroExGuardPolicy = { ...tenant.policy, feePayer: request.taker }
      if (effectivePolicy.commercialFee) await assertExistingFeeRecipient(connection, effectivePolicy.commercialFee.inputMint, effectivePolicy.commercialFee.recipientTokenAccount)
      const prepared = await prepareGuardedZeroExSwap(request, { router: routerFor(effectivePolicy), compiler, insight, policy: effectivePolicy, now, signal: requestOptions.signal })
      return { prepared, review: await reviewGuardedZeroExSwap(prepared, now), tenantId: tenant.tenantId }
    },
    async submit(input, requestOptions = {}) {
      if (requestOptions.signal?.aborted) throw requestOptions.signal.reason ?? new Error('Guarded 0x submission was aborted')
      assertAuthorizationId(input.authorizationId)
      await assertPreparedGuardedZeroExSwap(input.prepared, now)
      const unsigned = decodeSolanaTransaction(input.prepared.transactionBase64)
      const signed = decodeSolanaTransaction(input.signedTransactionBase64)
      await assertWireMessageMatches(unsigned, input.prepared.messageHash)
      await assertWireMessageMatches(signed, input.prepared.messageHash)
      if (!equalBytes(messageBytes(unsigned), messageBytes(signed))) throw new ZeroExGuardedSwapError('SIGNED_TRANSACTION_MESSAGE_MISMATCH', 'The signed transaction message differs from the guarded prepared message')
      await assertRequiredSignature(signed)
      const signature = signedTransactionSignature(signed)
      const acceptedAuthorization = await assertAcceptedAuthorization(options.authorizationStore, input.authorizationId, input.prepared, now)
      const intentHash = acceptedAuthorization.authorization.intentHash
      const commercialLedger = input.prepared.commercial.fee ? options.commercialLedger : undefined
      const commercialEvent = (type: ZeroExCommercialLedgerEvent['type']) => buildZeroExCommercialLedgerEvent({
        type,
        occurredAt: now(),
        authorizationId: input.authorizationId,
        intentHash,
        messageHash: input.prepared.messageHash,
        transactionSignature: signature,
        commercial: input.prepared.commercial,
      })
      if (input.prepared.commercial.fee) {
        if (!commercialLedger) throw new ZeroExGuardedSwapError('ZEROEX_COMMERCIAL_LEDGER_UNAVAILABLE', 'A durable 0x commercial ledger is required before broadcasting a fee-bearing transaction')
        // This write deliberately happens before the one-time claim. A ledger
        // outage can therefore stop the relay safely rather than creating an
        // unaccounted broadcast after authorization consumption.
        try { await commercialLedger.appendZeroExCommercialLedgerEvent(commercialEvent('RELAY_ATTEMPTED')) }
        catch { throw new ZeroExGuardedSwapError('ZEROEX_COMMERCIAL_LEDGER_UNAVAILABLE', 'Unable to record the fee-bearing 0x relay attempt') }
      }
      const claim = await options.authorizationStore.claimAuthorization(input.authorizationId, signature)
      if (!claim.ok) {
        if (commercialLedger) await commercialLedger.appendZeroExCommercialLedgerEvent(commercialEvent('RELAY_NOT_CLAIMED')).catch(() => {})
        throw new ZeroExGuardedSwapError(claim.code ?? 'AUTHORIZATION_ALREADY_USED', 'The PriorSeal authorization was already used or is unavailable')
      }
      let result: { signature: string; submission: 'SUBMITTED' | 'UNKNOWN' }
      try {
        const relayedSignature = await connection.sendRawTransaction(await signed.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0n })
        result = relayedSignature === signature ? { signature, submission: 'SUBMITTED' } : { signature, submission: 'UNKNOWN' }
      } catch {
        // RPC could have accepted before its response failed. The authorization remains bound.
        result = { signature, submission: 'UNKNOWN' }
      }
      if (commercialLedger) {
        try { await commercialLedger.appendZeroExCommercialLedgerEvent(commercialEvent(result.submission === 'SUBMITTED' ? 'RELAY_SUBMITTED' : 'RELAY_UNKNOWN')) }
        // The chain result cannot be treated as known until its corresponding
        // durable commercial event is available for reconciliation.
        catch { return { signature, submission: 'UNKNOWN' } }
      }
      return result
    },
  }
}

function bindCompilerToWireMessage(compiler: JupiterTransactionCompiler): JupiterTransactionCompiler {
  return {
    async compile(input, options = {}) {
      const compiled = await compiler.compile(input, options)
      await assertWireMessageMatches(decodeSolanaTransaction(compiled.transactionBase64), await hashSolanaTransactionMessage(compiled.transaction))
      return compiled
    },
  }
}

function decodeSolanaTransaction(value: string): Transaction | VersionedTransaction {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32_768 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError('signedTransactionBase64 must be canonical base64')
  const bytes = Uint8Array.from(Buffer.from(value, 'base64'))
  try { return VersionedTransaction.deserialize(bytes) } catch { return Transaction.from(bytes) }
}

async function assertRequiredSignature(transaction: Transaction | VersionedTransaction): Promise<void> {
  if (!(transaction instanceof VersionedTransaction)) {
    if (!await transaction.verifySignatures(true)) throw new ZeroExGuardedSwapError('SIGNED_TRANSACTION_SIGNATURE_INVALID', 'The signed transaction has an invalid required signature')
    return
  }
  if (transaction.signatures.length !== 1 || transaction.signatures[0]!.every(byte => byte === 0)) throw new ZeroExGuardedSwapError('SIGNED_TRANSACTION_SIGNATURE_MISSING', 'The signed transaction must contain exactly one fee-payer signature')
  const feePayer = transaction.message.staticAccountKeys[0]
  if (!feePayer || !await feePayer.verifySignature(transaction.signatures[0]!, transaction.message.serialize())) throw new ZeroExGuardedSwapError('SIGNED_TRANSACTION_SIGNATURE_INVALID', 'The signed transaction has an invalid required signature')
}

async function assertWireMessageMatches(transaction: Transaction | VersionedTransaction, expectedMessageHash: string): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(messageBytes(transaction)))
  const actual = `0x${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
  if (actual !== expectedMessageHash) throw new ZeroExGuardedSwapError('PREPARED_WIRE_MESSAGE_MISMATCH', 'The serialized transaction does not match the prepared guarded message')
}

function messageBytes(transaction: Transaction | VersionedTransaction): Uint8Array {
  return transaction instanceof VersionedTransaction ? transaction.message.serialize() : transaction.serializeMessage()
}

function signedTransactionSignature(transaction: Transaction | VersionedTransaction): string {
  if (transaction instanceof VersionedTransaction) return base58(transaction.signatures[0]!)
  const signature = transaction.signature
  if (!signature) throw new ZeroExGuardedSwapError('SIGNED_TRANSACTION_SIGNATURE_MISSING', 'The signed transaction has no fee-payer signature')
  return base58(signature)
}

function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const byte of bytes) integer = (integer << 8n) | BigInt(byte)
  let value = ''
  while (integer > 0) { value = alphabet[Number(integer % 58n)]! + value; integer /= 58n }
  let leadingZeroes = 0
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1
  return '1'.repeat(leadingZeroes) + value
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

async function assertAcceptedAuthorization(store: GuardedZeroExAuthorizationStore, authorizationId: string, prepared: PreparedGuardedZeroExSwap, now: () => number): Promise<GuardedZeroExAuthorizationRecord> {
  const record = await store.getAuthorization(authorizationId)
  if (!record || record.status !== 'ACCEPTED' || record.uses !== 0 || record.boundTxHash !== null) throw new ZeroExGuardedSwapError('AUTHORIZATION_NOT_FOUND', 'A fresh accepted PriorSeal authorization is required')
  if (record.authorization.intentHash !== preparedIntentHash(prepared) || record.authorization.expiresAt < Math.floor(now() / 1000) || record.authorization.delegate.executor !== prepared.transaction.feePayer || canonicalize(unsignedIntent(record.authorization.intent)) !== canonicalize(unsignedIntent(prepared.intent))) throw new ZeroExGuardedSwapError('AUTHORIZATION_INTENT_MISMATCH', 'The accepted authorization does not bind this guarded 0x transaction')
  return record
}

function preparedIntentHash(prepared: PreparedGuardedZeroExSwap): string {
  const { intentHash, ...intent } = prepared.intent
  const expected = hashJson(intent)
  if (intentHash !== undefined && intentHash !== expected) throw new ZeroExGuardedSwapError('AUTHORIZATION_INTENT_MISMATCH', 'The prepared 0x intent hash does not match the exact prepared intent')
  return expected
}

function unsignedIntent(value: { intentHash?: string }): Record<string, unknown> {
  const { intentHash: _intentHash, ...intent } = value
  return intent
}

function assertAuthorizationId(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new TypeError('authorizationId is invalid')
}

function assertDeploymentPolicy(value: GuardedZeroExDeploymentPolicy): GuardedZeroExDeploymentPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('PRIORSEAL_ZEROEX_POLICY_JSON must be an object')
  if ('commercialFee' in value) throw new TypeError('PRIORSEAL_ZEROEX_POLICY_JSON must not contain commercialFee; configure tenant-bound fees with PRIORSEAL_ZEROEX_TENANTS_JSON')
  return structuredClone(value)
}

function assertHttpsUrl(value: string): string {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') throw new TypeError('PRIORSEAL_ZEROEX_RPC_URL must use HTTPS')
  return parsed.toString()
}

function requiredSecret(value: string, label: string): string {
  const secret = value.trim()
  if (!secret) throw new TypeError(`${label} is required`)
  return secret
}

/**
 * 0x may only route a token fee to an account that already exists. Validate
 * the parsed SPL/Token-2022 account and mint immediately before requesting a
 * build, so a deployment typo cannot turn into an opaque upstream failure.
 */
async function assertExistingFeeRecipient(connection: Pick<Connection, 'getParsedAccountInfo'>, inputMint: string, recipientTokenAccount: string): Promise<void> {
  try {
    const response = await connection.getParsedAccountInfo(new PublicKey(recipientTokenAccount), 'confirmed')
    const data = (response.value as unknown as { data?: unknown } | null)?.data
    const parsed = data && typeof data === 'object' && !Array.isArray(data) ? data as { parsed?: unknown } : null
    const details = parsed?.parsed && typeof parsed.parsed === 'object' && !Array.isArray(parsed.parsed) ? parsed.parsed as { type?: unknown; info?: unknown } : null
    const info = details?.info && typeof details.info === 'object' && !Array.isArray(details.info) ? details.info as { mint?: unknown } : null
    if (details?.type !== 'account' || info?.mint !== inputMint) throw new ZeroExGuardedSwapError('ZEROEX_FEE_ACCOUNT_MISMATCH', 'Configured 0x fee recipient is not an existing token account for the input mint')
  } catch (error) {
    if (error instanceof ZeroExGuardedSwapError) throw error
    throw new ZeroExGuardedSwapError('ZEROEX_FEE_ACCOUNT_UNAVAILABLE', 'Unable to verify the configured 0x fee recipient token account')
  }
}
