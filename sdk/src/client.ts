import type {
  AcceptedAuthorization,
  Authorization,
  AuthorizationRecord,
  Eip1193Provider,
  ExactCallWalletAuthorizationInput,
  Intent,
  KeyRegistry,
  ObservationJob,
  ObservationResult,
  ObserveExecutionInput,
  PrepareAuthorizationInput,
  PreparedAuthorization,
  TransparencyEvidence,
  Receipt,
  RequestOptions,
  VerificationResult,
  VerificationBundle,
  WalletAuthorizationInput,
  WaitForObservationOptions,
  AuthorizationFlowOptions,
  AuthorizationCheckpoint,
  DeploymentCapabilities,
} from './types.js'
import { buildExactCallIntent } from './exact-call.js'

export type PriorSealClientOptions = {
  baseUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
  headers?: HeadersInit
  idempotencyKey?: () => string
}

export class PriorSealApiError extends Error {
  readonly code?: string
  readonly status?: number
  readonly details?: unknown

  constructor(message: string, options: { code?: string; status?: number; details?: unknown; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'PriorSealApiError'
    this.code = options.code
    this.status = options.status
    this.details = options.details
  }
}

export class PriorSealClient {
  readonly baseUrl: string
  readonly timeoutMs: number
  private readonly fetcher: typeof fetch
  private readonly defaultHeaders: HeadersInit
  private readonly makeIdempotencyKey: () => string

  constructor(options: PriorSealClientOptions = {}) {
    const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis)
    if (!fetcher) throw new TypeError('PriorSealClient requires a Fetch-compatible implementation')
    this.fetcher = fetcher
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 15_000
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new TypeError('timeoutMs must be a positive integer')
    this.defaultHeaders = options.headers ?? {}
    this.makeIdempotencyKey = options.idempotencyKey ?? generateIdempotencyKey
  }

  health(options?: RequestOptions) {
    return this.request<{ status: string; requestId?: string }>('/health/live', {}, options)
  }

  readiness(options?: RequestOptions) {
    return this.request<{ status: string; storage?: string; requestId?: string }>('/health/ready', {}, options)
  }

  version(options?: RequestOptions) {
    return this.request<{ service: string; version: string; protocol: string[]; requestId?: string }>('/v1/version', {}, options)
  }

  capabilities(options?: RequestOptions) {
    return this.request<DeploymentCapabilities>('/v1/capabilities', {}, options)
  }

  createIntent(intent: Intent, options?: RequestOptions) {
    return this.request<{ intent: Intent; intentHash: string; policy: { allowed: boolean; reasonCodes: string[]; policyId: string | null }; requestId?: string }>('/v1/intents', { method: 'POST', body: JSON.stringify(intent) }, options)
  }

  prepareAuthorization(input: PrepareAuthorizationInput, options?: RequestOptions) {
    return this.request<PreparedAuthorization>('/v1/authorizations/prepare', { method: 'POST', body: JSON.stringify(input) }, options)
  }

  authorize(authorization: Authorization, options?: RequestOptions) {
    return this.request<AcceptedAuthorization>('/v1/authorizations', { method: 'POST', body: JSON.stringify(authorization) }, options)
  }

  acceptAuthorization(authorization: Authorization, options?: RequestOptions) {
    return this.authorize(authorization, options)
  }

  authorization(id: string, options?: RequestOptions) {
    return this.request<AuthorizationRecord>(`/v1/authorizations/${encodeURIComponent(id)}`, {}, options)
  }

  getAuthorization(id: string, options?: RequestOptions) {
    return this.authorization(id, options)
  }

  transparency(authorizationId: string, options?: RequestOptions) {
    return this.request<TransparencyEvidence>(`/v1/authorizations/${encodeURIComponent(authorizationId)}/transparency`, {}, options)
  }

  getTransparencyEvidence(authorizationId: string, options?: RequestOptions) {
    return this.transparency(authorizationId, options)
  }

  observe(input: ObserveExecutionInput, options?: RequestOptions) {
    return this.request<ObservationResult>('/v1/executions/observe', { method: 'POST', body: JSON.stringify({ ...input, confirmations: input.confirmations ?? 0 }) }, options)
  }

  observeExecution(input: ObserveExecutionInput, options?: RequestOptions) {
    return this.observe(input, options)
  }

  observationJob(jobId: string, options?: RequestOptions) {
    return this.request<ObservationJob>(`/v1/observation-jobs/${encodeURIComponent(jobId)}`, {}, options)
  }

  getObservationJob(jobId: string, options?: RequestOptions) {
    return this.observationJob(jobId, options)
  }

  async waitForObservationJob(jobId: string, options: WaitForObservationOptions = {}) {
    const pollIntervalMs = options.pollIntervalMs ?? 1_000
    const timeoutMs = options.timeoutMs ?? 120_000
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10) throw new TypeError('pollIntervalMs must be an integer of at least 10')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive integer')
    const startedAt = Date.now()
    while (true) {
      const job = await this.observationJob(jobId, options)
      if (['COMPLETED', 'UNDETERMINED', 'FAILED'].includes(job.state)) return job
      if (Date.now() - startedAt >= timeoutMs) throw new PriorSealApiError(`Observation job did not finish within ${timeoutMs}ms; resume this job instead of submitting a new transaction`, { code: 'OBSERVATION_WAIT_TIMEOUT', details: { jobId, authorizationId: job.input?.authorizationId, txHash: job.input?.txHash, job, retryAfterMs: pollIntervalMs } })
      const retryWaitMs = job.state === 'RETRY_WAIT' && Number.isFinite(job.nextAttemptAt) ? Math.max(0, job.nextAttemptAt - Date.now()) : 0
      await abortableDelay(Math.min(Math.max(pollIntervalMs, retryWaitMs), Math.max(1, timeoutMs - (Date.now() - startedAt))), options.signal)
    }
  }

  async observeExecutionUntilFinal(input: ObserveExecutionInput, options: WaitForObservationOptions = {}) {
    const initial = await this.observeExecution(input, options)
    if (!initial.observationJob) return initial
    const job = await this.waitForObservationJob(initial.observationJob.jobId, options)
    if (job.result) return { ...job.result, observationJob: job }
    return { ...initial, observation: job.observation ?? initial.observation, observationJob: job }
  }

  receipt(id: string, options?: RequestOptions) {
    return this.request<Receipt>(`/v1/receipts/${encodeURIComponent(id)}`, {}, options)
  }

  getReceipt(id: string, options?: RequestOptions) {
    return this.receipt(id, options)
  }

  verificationBundle(id: string, options?: RequestOptions) {
    return this.request<VerificationBundle>(`/v1/receipts/${encodeURIComponent(id)}/bundle`, {}, options)
  }

  getVerificationBundle(id: string, options?: RequestOptions) {
    return this.verificationBundle(id, options)
  }

  verify(receipt: Receipt, options?: RequestOptions) {
    return this.request<{ convenienceEndpoint: true; independentVerification: string; result: VerificationResult; requestId?: string }>('/v1/receipts/verify', { method: 'POST', body: JSON.stringify({ receipt }) }, options)
  }

  async verifyReceiptRemotely(receipt: Receipt, options?: RequestOptions) {
    return (await this.verify(receipt, options)).result
  }

  keys(options?: RequestOptions) {
    return this.request<KeyRegistry>('/.well-known/priorseal-keys.json', {}, options)
  }

  getKeyRegistry(options?: RequestOptions) {
    return this.keys(options)
  }

  async authorizeWithWallet(input: WalletAuthorizationInput, provider: Eip1193Provider, options: AuthorizationFlowOptions = {}) {
    const checkpoint = options.checkpoint
    if (checkpoint && (checkpoint.schema !== 'priorseal.authorization-checkpoint.v1' || stableJson(checkpoint.request) !== stableJson(input) || !checkpoint.acceptIdempotencyKey || !['PREPARED', 'SIGNED', 'ACCEPTED'].includes(checkpoint.stage))) throw new PriorSealApiError('Checkpoint does not belong to this authorization request', { code: 'AUTHORIZATION_CHECKPOINT_MISMATCH' })
    const accounts = checkpoint ? [checkpoint.account] : input.account ? [input.account] : await provider.request({ method: 'eth_requestAccounts' }) as string[]
    const account = accounts[0]?.toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(account ?? '')) throw new PriorSealApiError('The wallet did not return a valid EVM account', { code: 'WALLET_ACCOUNT_UNAVAILABLE' })
    const issuedAt = input.issuedAt ?? checkpoint?.prepared.authorization.issuedAt ?? Math.floor(Date.now() / 1000)
    const prepared = checkpoint?.prepared ?? await this.prepareAuthorization({
      intent: input.intent,
      principal: { ...input.principal, account },
      authorizer: { type: 'eip712', address: account },
      delegate: input.delegate,
      issuedAt,
      notBefore: input.notBefore ?? issuedAt,
      expiresAt: input.expiresAt ?? input.intent.validUntil,
      authorizationNonce: input.authorizationNonce ?? generateAuthorizationNonce(),
      maxUses: input.maxUses ?? '1',
      audience: input.audience ?? 'priorseal',
    }, options)
    if (stableJson(comparableIntent(prepared.authorization.intent)) !== stableJson(comparableIntent(input.intent)) || prepared.authorization.principal.account.toLowerCase() !== account || prepared.authorization.authorizer.address.toLowerCase() !== account || prepared.authorization.principal.id !== input.principal.id || prepared.authorization.principal.type !== input.principal.type || prepared.authorization.delegate.agentId !== input.delegate.agentId || prepared.authorization.delegate.executor.toLowerCase() !== input.delegate.executor.toLowerCase()) throw new PriorSealApiError('Prepared authorization does not match the requested intent and identity', { code: 'AUTHORIZATION_CHECKPOINT_MISMATCH' })
    const authorization = prepared.authorization
    const expectedNotBefore = input.notBefore ?? issuedAt
    const expectedExpiresAt = input.expiresAt ?? input.intent.validUntil
    if (authorization.schema !== 'priorseal.authorization.v2' || authorization.authorizer.type !== 'eip712' || authorization.audience !== (input.audience ?? 'priorseal') || authorization.issuedAt !== issuedAt || authorization.notBefore !== expectedNotBefore || authorization.expiresAt !== expectedExpiresAt || authorization.maxUses !== (input.maxUses ?? '1') || (input.authorizationNonce !== undefined && authorization.authorizationNonce.toLowerCase() !== input.authorizationNonce.toLowerCase()) || (input.account && account !== input.account.toLowerCase()) || (checkpoint?.stage === 'PREPARED' && checkpoint.signature) || (checkpoint && checkpoint.stage !== 'PREPARED' && !checkpoint.signature)) throw new PriorSealApiError('Prepared authorization differs from requested audience, timing or permissions', { code: 'AUTHORIZATION_CHECKPOINT_MISMATCH' })
    const { hashTypedData, verifyTypedData } = await import('./authorization-signature.js')
    let signingData: Awaited<ReturnType<typeof import('./verifier.js')['authorizationSigningData']>>
    try {
      const { authorizationSigningData } = await import('./verifier.js')
      signingData = await authorizationSigningData(authorization)
      if (hashTypedData(signingData) !== hashTypedData(prepared.typedData as unknown as Parameters<typeof hashTypedData>[0])) throw new Error('Prepared typed data does not match authorization')
    } catch (error) {
      throw new PriorSealApiError('Prepared authorization or wallet typed data is inconsistent', { code: 'AUTHORIZATION_CHECKPOINT_MISMATCH', cause: error })
    }
    const state: AuthorizationCheckpoint = { schema: 'priorseal.authorization-checkpoint.v1', stage: checkpoint?.signature ? 'SIGNED' : 'PREPARED', account, request: structuredClone(input), prepared, ...(checkpoint?.signature ? { signature: checkpoint.signature } : {}), acceptIdempotencyKey: checkpoint?.acceptIdempotencyKey ?? options.idempotencyKey ?? this.makeIdempotencyKey() }
    await options.onCheckpoint?.(structuredClone(state))
    if (!state.signature && prepared.authorization.expiresAt <= Math.floor(Date.now() / 1000)) throw new PriorSealApiError('Authorization expired before wallet signing; refresh and authorize again', { code: 'AUTHORIZATION_EXPIRED', details: { checkpoint: state } })
    const signature = state.signature ?? await provider.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(signingData, (_key, value) => typeof value === 'bigint' ? value.toString() : value)] })
    if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new PriorSealApiError('The wallet did not return an EVM signature', { code: 'WALLET_SIGNATURE_UNAVAILABLE' })
    if (!await verifyTypedData({ ...signingData, address: account as `0x${string}`, signature: signature as `0x${string}` }).catch(() => false)) throw new PriorSealApiError('Signature does not match the requested authorization and account', { code: 'AUTHORIZATION_SIGNATURE_MISMATCH' })
    state.signature = signature
    state.stage = 'SIGNED'
    await options.onCheckpoint?.(structuredClone(state))
    // An accepted operation may be replayed after expiry. The server decides;
    // keep exactly the same signed bytes and acceptance idempotency key.
    let accepted: AcceptedAuthorization
    try {
      accepted = await this.authorize({ ...prepared.authorization, signature }, { ...options, idempotencyKey: state.acceptIdempotencyKey })
    } catch (error) {
      if (error instanceof PriorSealApiError) throw new PriorSealApiError(error.message, { code: error.code, status: error.status, details: { checkpoint: structuredClone(state), originalDetails: error.details }, cause: error })
      throw error
    }
    if (accepted.acceptance?.status !== 'ACCEPTED' || accepted.acceptance.authorizationId !== prepared.authorization.authorizationId || stableJson(accepted.authorization) !== stableJson({ ...prepared.authorization, signature })) throw new PriorSealApiError('Accepted authorization differs from the signed authorization', { code: 'AUTHORIZATION_RESPONSE_MISMATCH', details: { checkpoint: state } })
    state.stage = 'ACCEPTED'
    await options.onCheckpoint?.(structuredClone(state))
    const checkedAt = Math.floor(Date.now() / 1000)
    return { account, signature, prepared, accepted, checkpoint: state, authorizationWindow: { checkedAt, active: prepared.authorization.notBefore <= checkedAt && checkedAt < prepared.authorization.expiresAt, expiresAt: prepared.authorization.expiresAt }, nextAction: checkedAt >= prepared.authorization.expiresAt ? 'REVIEW_ACCEPTED_HISTORY_DO_NOT_EXECUTE' as const : checkedAt < prepared.authorization.notBefore ? 'WAIT_UNTIL_AUTHORIZATION_WINDOW' as const : 'CHECK_DISPATCH_POLICY' as const }
  }

  authorizeExactCallWithWallet(input: ExactCallWalletAuthorizationInput, provider: Eip1193Provider, options?: AuthorizationFlowOptions) {
    const intent = buildExactCallIntent(input)
    return this.authorizeWithWallet({
      intent,
      principal: input.principal,
      delegate: { agentId: input.agentId, executor: intent.sender },
      account: input.account,
      issuedAt: input.issuedAt,
      notBefore: input.notBefore,
      expiresAt: input.expiresAt,
      authorizationNonce: input.authorizationNonce,
      audience: input.audience,
    }, provider, options)
  }

  private async request<T>(path: string, init: RequestInit, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController()
    const onAbort = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) controller.abort(options.signal.reason)
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error('PriorSeal request timed out')), this.timeoutMs)
    const headers = new Headers(this.defaultHeaders)
    new Headers(options.headers).forEach((value, key) => headers.set(key, value))
    headers.set('Accept', 'application/json')
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json')
      headers.set('Idempotency-Key', options.idempotencyKey ?? this.makeIdempotencyKey())
    }
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal })
      const text = await response.text()
      const data = text ? safeJson(text) : null
      if (!response.ok) {
        const payload = data as { error?: { code?: string; message?: string; details?: unknown } } | null
        throw new PriorSealApiError(payload?.error?.message ?? `PriorSeal request failed (${response.status})`, { code: payload?.error?.code, status: response.status, details: payload?.error?.details })
      }
      return data as T
    } catch (error) {
      if (error instanceof PriorSealApiError) throw error
      if (controller.signal.aborted) {
        const external = options.signal?.aborted
        throw new PriorSealApiError(external ? 'PriorSeal request was aborted' : `The PriorSeal API did not respond within ${this.timeoutMs}ms`, { code: external ? 'REQUEST_ABORTED' : 'REQUEST_TIMEOUT', cause: error })
      }
      throw new PriorSealApiError(error instanceof Error ? error.message : 'PriorSeal request failed', { code: 'NETWORK_ERROR', cause: error })
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }
}

export function createPriorSealClient(options?: PriorSealClientOptions) {
  return new PriorSealClient(options)
}

export function generateAuthorizationNonce() {
  const random = new Uint8Array(32)
  requireCrypto().getRandomValues(random)
  return `0x${[...random].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function generateIdempotencyKey() {
  const crypto = requireCrypto()
  return crypto.randomUUID ? crypto.randomUUID() : `priorseal_${generateAuthorizationNonce().slice(2, 34)}`
}

function requireCrypto() {
  if (!globalThis.crypto?.getRandomValues) throw new TypeError('PriorSeal SDK requires Web Crypto')
  return globalThis.crypto
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value) } catch { throw new PriorSealApiError('PriorSeal API returned invalid JSON', { code: 'INVALID_RESPONSE' }) }
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}

function comparableIntent(intent: Intent) {
  const { intentHash: _hash, ...value } = intent
  return { ...value, schema: intent.schema ?? (intent.executionProfile ? 'priorseal.intent.v2' : 'priorseal.intent.v1'), chainId: Number(intent.chainId), amount: String(intent.amount), nonce: String(intent.nonce ?? '0'), sender: intent.sender.toLowerCase(), recipient: intent.recipient.toLowerCase(), ...(intent.callTarget ? { callTarget: intent.callTarget.toLowerCase() } : {}), ...(intent.calldataHash ? { calldataHash: intent.calldataHash.toLowerCase() } : {}), ...(intent.contextCommitments ? { contextCommitments: intent.contextCommitments.map(c => ({ ...c, digest: c.digest.toLowerCase() })).sort((a, b) => `${a.namespace}:${a.algorithm}:${a.digest}`.localeCompare(`${b.namespace}:${b.algorithm}:${b.digest}`)) } : {}) }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new PriorSealApiError('PriorSeal request was aborted', { code: 'REQUEST_ABORTED' }))
    const timer = setTimeout(done, milliseconds)
    function done() { signal?.removeEventListener('abort', aborted); resolve() }
    function aborted() { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(new PriorSealApiError('PriorSeal request was aborted', { code: 'REQUEST_ABORTED' })) }
    signal?.addEventListener('abort', aborted, { once: true })
  })
}
