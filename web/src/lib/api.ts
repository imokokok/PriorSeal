import { createPriorSealClient, validatePriorSealResponse, type DeploymentCapabilities } from 'priorseal-sdk'

export const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export const api = createPriorSealClient({ baseUrl: BASE_URL, timeoutMs: 15_000 })

export type Capabilities = DeploymentCapabilities

export async function consoleRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(15_000) })
  const body: unknown = await response.json()
  if (!response.ok) {
    const errorBody = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
    const detail = errorBody?.error && typeof errorBody.error === 'object' && !Array.isArray(errorBody.error) ? errorBody.error as Record<string, unknown> : null
    const retryAfter = response.headers.get('Retry-After')
    const retryAfterMs = retryAfter === null ? undefined : /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())
    throw Object.assign(new Error(typeof detail?.message === 'string' ? detail.message : typeof errorBody?.message === 'string' ? errorBody.message : `Request failed (${response.status})`), { status: response.status, retryAfterMs })
  }
  validatePriorSealResponse(path, body)
  return body as T
}

export const getCapabilities = () => api.capabilities()
