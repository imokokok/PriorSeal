const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const MAX_HEADER_BYTES = 64 * 1024
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export type X402ExactRequirement = {
  scheme: 'exact'
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra: Record<string, string>
}

export type X402PaymentChallenge = {
  x402Version: 2
  resource: { url: string; description?: string; mimeType?: string; serviceName?: string }
  accepts: X402ExactRequirement[]
}

/** A principal-controlled service-payer boundary. It returns a signed x402 v2 PAYMENT-SIGNATURE header. */
export type X402PaymentSigner = (input: {
  request: { url: string; method: 'GET' }
  challenge: X402PaymentChallenge
  allowedRequirements: X402ExactRequirement[]
}) => Promise<string>

/**
 * Explicit spend limits for a payment-capable agent transport. `allowPath`
 * should be as narrow as the buyer's intended PriorSeal resource route.
 */
export type X402PaymentPolicy = {
  allowedOrigins: readonly string[]
  allowPath: (pathname: string) => boolean
  maxAmountAtomic: string
  allowedNetworks?: readonly string[]
  allowedAssets?: readonly string[]
  allowedPayTos?: readonly string[]
}

/**
 * Wraps a Fetch implementation so an agent can make one constrained x402 v2
 * payment retry after an HTTP 402 challenge. It never pays POST requests,
 * follows no payment retry loop, and verifies that the signer selected one of
 * the challenge's policy-approved exact requirements.
 */
export function createX402AgentFetch({ fetch: fetcher = globalThis.fetch?.bind(globalThis), signer, policy }: { fetch?: typeof fetch; signer: X402PaymentSigner; policy: X402PaymentPolicy }): typeof fetch {
  if (!fetcher) throw new TypeError('createX402AgentFetch requires a Fetch-compatible implementation')
  const normalizedPolicy = normalizePolicy(policy)
  // Cloudflare's ambient Fetch overload uses a branded Request generic while
  // browsers and Node expose the standard Request. The runtime contract is the
  // same; keep that declaration difference at this boundary.
  const fetchRequest = (request: unknown) => (fetcher as unknown as (input: unknown) => Promise<Response>)(request)
  return async (input, init) => {
    const request = new Request(input, init)
    if (request.method !== 'GET') return fetchRequest(request)
    const first = await fetchRequest(request.clone())
    if (first.status !== 402 || request.headers.has('payment-signature')) return first
    const challenge = parseChallenge(first.headers.get('payment-required'), request.url)
    const resource = new URL(request.url)
    if (!normalizedPolicy.origins.has(resource.origin) || !normalizedPolicy.allowPath(resource.pathname)) throw new TypeError('The requested x402 resource is outside the configured agent payment policy')
    const allowedRequirements = challenge.accepts.filter(requirement => policyAllows(requirement, normalizedPolicy))
    if (!allowedRequirements.length) throw new TypeError('No x402 payment requirement is within the configured agent payment policy')
    const signature = await signer({ request: { url: request.url, method: 'GET' }, challenge, allowedRequirements: structuredClone(allowedRequirements) })
    const accepted = parsePaymentSignature(signature)
    if (!challenge.accepts.some(requirement => sameRequirement(requirement, accepted)) || !policyAllows(accepted, normalizedPolicy)) {
      throw new TypeError('The agent payment signer selected a requirement outside the requested challenge or configured policy')
    }
    const headers = new Headers(request.headers)
    headers.set('payment-signature', signature)
    return fetchRequest(new Request(request, { headers }))
  }
}

function normalizePolicy(policy: X402PaymentPolicy) {
  if (!policy || !Array.isArray(policy.allowedOrigins) || !policy.allowedOrigins.length || typeof policy.allowPath !== 'function' || !/^(0|[1-9][0-9]*)$/.test(policy.maxAmountAtomic)) throw new TypeError('Invalid x402 agent payment policy')
  const maxAmountAtomic = BigInt(policy.maxAmountAtomic)
  if (maxAmountAtomic < 1n) throw new TypeError('x402 agent payment policy requires a positive maxAmountAtomic')
  const origins = new Set(policy.allowedOrigins.map(origin => {
    const parsed = new URL(origin)
    if (parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) throw new TypeError('x402 agent payment policy contains an invalid allowed origin')
    return parsed.origin
  }))
  return {
    origins,
    allowPath: policy.allowPath,
    maxAmountAtomic,
    networks: policy.allowedNetworks ? new Set(policy.allowedNetworks) : null,
    assets: policy.allowedAssets ? new Set(policy.allowedAssets) : null,
    payTos: policy.allowedPayTos ? new Set(policy.allowedPayTos) : null,
  }
}

function parseChallenge(header: string | null, expectedUrl: string): X402PaymentChallenge {
  const value = decodeBase64Json(header, 'PAYMENT-REQUIRED')
  if (!isRecord(value) || value.x402Version !== 2 || !isRecord(value.resource) || typeof value.resource.url !== 'string' || !Array.isArray(value.accepts)) throw new TypeError('Invalid x402 PAYMENT-REQUIRED challenge')
  const resourceUrl = new URL(value.resource.url)
  if (resourceUrl.toString() !== expectedUrl) throw new TypeError('x402 PAYMENT-REQUIRED resource URL does not match the requested resource')
  const accepts = value.accepts.map(parseRequirement)
  if (!accepts.length) throw new TypeError('x402 PAYMENT-REQUIRED challenge has no exact payment options')
  return { x402Version: 2, resource: { url: resourceUrl.toString(), ...(typeof value.resource.description === 'string' ? { description: value.resource.description } : {}), ...(typeof value.resource.mimeType === 'string' ? { mimeType: value.resource.mimeType } : {}), ...(typeof value.resource.serviceName === 'string' ? { serviceName: value.resource.serviceName } : {}) }, accepts }
}

function parsePaymentSignature(header: string): X402ExactRequirement {
  const value = decodeBase64Json(header, 'PAYMENT-SIGNATURE')
  if (!isRecord(value) || value.x402Version !== 2) throw new TypeError('Invalid x402 PAYMENT-SIGNATURE payload')
  return parseRequirement(value.accepted)
}

function parseRequirement(value: unknown): X402ExactRequirement {
  if (!isRecord(value)) throw new TypeError('Invalid x402 exact payment requirement')
  const { scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra } = value
  if (scheme !== 'exact' || typeof network !== 'string' || typeof amount !== 'string' || !/^(0|[1-9][0-9]*)$/.test(amount) || typeof asset !== 'string' || typeof payTo !== 'string' || typeof maxTimeoutSeconds !== 'number' || !Number.isSafeInteger(maxTimeoutSeconds) || maxTimeoutSeconds < 1 || !isStringRecord(extra)) throw new TypeError('Invalid x402 exact payment requirement')
  return { scheme: 'exact', network, amount, asset, payTo, maxTimeoutSeconds, extra }
}

function policyAllows(requirement: X402ExactRequirement, policy: ReturnType<typeof normalizePolicy>) {
  return BigInt(requirement.amount) <= policy.maxAmountAtomic
    && (!policy.networks || policy.networks.has(requirement.network))
    && (!policy.assets || policy.assets.has(requirement.asset))
    && (!policy.payTos || policy.payTos.has(requirement.payTo))
}

function sameRequirement(left: X402ExactRequirement, right: X402ExactRequirement) {
  return left.scheme === right.scheme && left.network === right.network && left.amount === right.amount && left.asset === right.asset && left.payTo === right.payTo && left.maxTimeoutSeconds === right.maxTimeoutSeconds && stableJson(left.extra) === stableJson(right.extra)
}

function decodeBase64Json(value: string | null, label: string): unknown {
  if (!value || value.length > MAX_HEADER_BYTES || !BASE64.test(value)) throw new TypeError(`Invalid ${label} header`)
  let binary: string
  try { binary = atob(value) } catch { throw new TypeError(`Invalid ${label} header`) }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new TypeError(`Invalid ${label} header`) }
  assertSafeJson(parsed)
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(entry => typeof entry === 'string')
}

function assertSafeJson(value: unknown, depth = 0): void {
  if (depth > 64) throw new TypeError('x402 header JSON is too deeply nested')
  if (Array.isArray(value)) { value.forEach(entry => assertSafeJson(entry, depth + 1)); return }
  if (!isRecord(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new TypeError('x402 header JSON contains a dangerous key')
    assertSafeJson(entry, depth + 1)
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}
