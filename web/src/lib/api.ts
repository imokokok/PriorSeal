import type { ApiError, Authorization, AuthorizationReceipt, Intent, KeyRegistry, PolicyEvidence, Receipt, VerificationResult, Execution, TimestampEvidence, WitnessEvidence } from '../types'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const timeoutMs = 15_000

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const id = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options, signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } : {}), ...options.headers }
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const payload = data as { error?: { code?: string; message?: string; details?: unknown } } | null
      const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`) as ApiError
      error.code = payload?.error?.code; error.status = response.status; error.details = payload?.error?.details
      throw error
    }
    return data as T
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      const error = new Error('The API did not respond within 15 seconds. Check that the PriorSeal API is running.') as ApiError
      error.code = 'REQUEST_TIMEOUT'; throw error
    }
    throw caught
  } finally { window.clearTimeout(id) }
}

export const api = {
  health: () => request<{ status: string; requestId?: string }>('/health/live'),
  readiness: () => request<{ status: string; storage?: string; requestId?: string }>('/health/ready'),
  createIntent: (intent: Intent) => request<{ intent: Intent; intentHash: string; policy: { allowed: boolean; reasonCodes: string[]; policyId: string | null } }>('/v1/intents', { method: 'POST', body: JSON.stringify(intent) }),
  prepareAuthorization: (authorization: Omit<Authorization, 'schema' | 'domain' | 'authorizationId' | 'intentHash' | 'signature' | 'policyHash'> & { policyHash?: string }) => request<{ authorization: Authorization; typedData: Record<string, unknown> }>('/v1/authorizations/prepare', { method: 'POST', body: JSON.stringify(authorization) }),
  authorize: (authorization: Authorization) => request<{ authorization: Authorization; acceptance: AuthorizationReceipt; policyEvidence?: PolicyEvidence; timestampEvidence?: TimestampEvidence; witnessEvidence?: WitnessEvidence; policy: { allowed: boolean; reasonCodes: string[]; policyId: string | null } }>('/v1/authorizations', { method: 'POST', body: JSON.stringify(authorization) }),
  authorization: (id: string) => request<{ authorization: Authorization; acceptance: AuthorizationReceipt; status: string; boundTxHash: string | null; uses: number }>(`/v1/authorizations/${encodeURIComponent(id)}`),
  observe: (input: { intentId?: string; authorizationId?: string; chainId: number; txHash: string; confirmations: number }) => request<{ observation: Execution; receipt: Receipt | null; verification?: VerificationResult }>('/v1/executions/observe', { method: 'POST', body: JSON.stringify(input) }),
  receipt: (id: string) => request<Receipt>(`/v1/receipts/${encodeURIComponent(id)}`),
  verify: (receipt: Receipt) => request<{ convenienceEndpoint: true; independentVerification: string; result: VerificationResult }>('/v1/receipts/verify', { method: 'POST', body: JSON.stringify({ receipt }) }),
  keys: () => request<KeyRegistry>('/.well-known/priorseal-keys.json')
}
