import type {
  AcceptedAuthorization,
  Authorization,
  AuthorizationRecord,
  Eip1193Provider,
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
  WalletAuthorizationInput,
} from './types.js'

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
    const fetcher = options.fetch ?? globalThis.fetch
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

  receipt(id: string, options?: RequestOptions) {
    return this.request<Receipt>(`/v1/receipts/${encodeURIComponent(id)}`, {}, options)
  }

  getReceipt(id: string, options?: RequestOptions) {
    return this.receipt(id, options)
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

  async authorizeWithWallet(input: WalletAuthorizationInput, provider: Eip1193Provider, options?: RequestOptions) {
    const accounts = input.account ? [input.account] : await provider.request({ method: 'eth_requestAccounts' }) as string[]
    const account = accounts[0]?.toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(account ?? '')) throw new PriorSealApiError('The wallet did not return a valid EVM account', { code: 'WALLET_ACCOUNT_UNAVAILABLE' })
    const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000)
    const prepared = await this.prepareAuthorization({
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
    const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(prepared.typedData)] })
    if (typeof signature !== 'string' || !signature.startsWith('0x')) throw new PriorSealApiError('The wallet did not return an EVM signature', { code: 'WALLET_SIGNATURE_UNAVAILABLE' })
    const accepted = await this.authorize({ ...prepared.authorization, signature }, options)
    return { account, signature, prepared, accepted }
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
