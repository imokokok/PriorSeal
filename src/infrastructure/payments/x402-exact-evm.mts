import { getAddress } from 'viem';
import { assertSafeJson } from '../../shared/safe-json.mjs';

export const X402_NETWORKS = Object.freeze([
  { network: 'eip155:8453', chainId: 8453, name: 'Base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', assetName: 'USD Coin', assetVersion: '2' },
  { network: 'eip155:42161', chainId: 42161, name: 'Arbitrum One', asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', assetName: 'USD Coin', assetVersion: '2' },
  { network: 'eip155:143', chainId: 143, name: 'Monad', asset: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', assetName: 'USDC', assetVersion: '2' },
] as const);

const MAX_FACILITATOR_RESPONSE_BYTES = 64 * 1024;
const PAYMENT_HEADER_LIMIT = 64 * 1024;
const MAX_TIMEOUT_MS = 2_147_483_647;
const RESERVED_FACILITATOR_HEADERS = new Set(['content-type', 'content-length', 'host', 'connection', 'transfer-encoding', 'payment-signature', 'payment-required', 'payment-response']);

export type X402Requirement = {
  scheme: 'exact';
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

export type X402PaymentPayload = {
  x402Version: 2;
  accepted: X402Requirement;
  payload: Record<string, unknown>;
  resource?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
};

export type X402Route = { method: 'GET'; path: string; description: string; price: string; regex: RegExp };
export type X402Config = {
  facilitatorUrl: string;
  facilitatorHeaders: Partial<Record<'supported' | 'verify' | 'settle', Record<string, string>>>;
  resourceOrigin: string;
  payTo: string;
  timeoutMs: number;
  routes: X402Route[];
};

type X402Environment = Partial<Record<
  'PRIORSEAL_X402_FACILITATOR_URL' | 'PRIORSEAL_X402_FACILITATOR_HEADERS_JSON' |
  'PRIORSEAL_X402_RESOURCE_ORIGIN' | 'PRIORSEAL_X402_PAY_TO' |
  'PRIORSEAL_X402_TIMEOUT_MS' | 'PRIORSEAL_X402_ROUTES_JSON', string
>>;

export type X402PaymentContext = { payload: X402PaymentPayload; requirement: X402Requirement };

type FacilitatorCapability = { kinds: { x402Version: number; scheme: string; network: string }[] };

const capabilityCache = new Map<string, { expiresAt: number; promise: Promise<Set<string>> }>();

/** Parse opt-in x402 settings at the runtime boundary. No payment routes are active by default. */
export function parseX402Config(environment: X402Environment): X402Config | undefined {
  const raw = {
    facilitatorUrl: optional(environment.PRIORSEAL_X402_FACILITATOR_URL),
    facilitatorHeadersJson: optional(environment.PRIORSEAL_X402_FACILITATOR_HEADERS_JSON),
    resourceOrigin: optional(environment.PRIORSEAL_X402_RESOURCE_ORIGIN),
    payTo: optional(environment.PRIORSEAL_X402_PAY_TO),
    timeoutMs: optional(environment.PRIORSEAL_X402_TIMEOUT_MS),
    routesJson: optional(environment.PRIORSEAL_X402_ROUTES_JSON),
  };
  if (!Object.values(raw).some(Boolean)) return undefined;
  for (const field of ['facilitatorUrl', 'resourceOrigin', 'payTo', 'routesJson'] as const) {
    if (!raw[field]) throw new TypeError(`PRIORSEAL_X402_${field === 'routesJson' ? 'ROUTES_JSON' : field === 'facilitatorUrl' ? 'FACILITATOR_URL' : field === 'resourceOrigin' ? 'RESOURCE_ORIGIN' : 'PAY_TO'} is required when x402 is configured`);
  }

  const facilitatorUrl = parseFacilitatorUrl(raw.facilitatorUrl!);
  const resourceOrigin = parseResourceOrigin(raw.resourceOrigin!);
  const payTo = parseEvmAddress(raw.payTo!, 'PRIORSEAL_X402_PAY_TO');
  const timeoutMs = parseTimeout(raw.timeoutMs);
  const facilitatorHeaders = parseFacilitatorHeaders(raw.facilitatorHeadersJson);
  const routes = parseRoutes(raw.routesJson!);
  return { facilitatorUrl, facilitatorHeaders, resourceOrigin, payTo, timeoutMs, routes };
}

export function matchX402Route(config: X402Config | undefined, method: string | undefined, path: string) {
  if (!config || method?.toUpperCase() !== 'GET') return undefined;
  return config.routes.find(route => route.regex.test(path));
}

/** Implements the x402 v2 HTTP lifecycle through the configured facilitator. */
export function createX402PaymentService(config: X402Config) {
  return {
    async prepare(route: X402Route, resourceUrl: string, paymentHeader: string | undefined, signal?: AbortSignal): Promise<{ kind: 'required'; response: Record<string, unknown>; header: string } | { kind: 'invalid'; status: 400 | 402; response: Record<string, unknown>; header: string } | { kind: 'authorized'; context: X402PaymentContext }> {
      const supported = await getSupportedNetworks(config, signal);
      const requirements = X402_NETWORKS.map(network => makeRequirement(config, route, network))
        .filter(requirement => supported.has(requirement.network));
      if (requirements.length === 0) throw new Error('Configured facilitator does not support exact EVM payments on any configured network');
      const resource = { url: resourceUrl, description: route.description, mimeType: 'application/json', serviceName: 'PriorSeal' };
      let payload: X402PaymentPayload | undefined;
      let malformed = false;
      if (paymentHeader) {
        try { payload = decodePaymentHeader(paymentHeader); } catch { malformed = true; }
      }
      const paymentRequired = (error: string) => ({ x402Version: 2, error, resource, accepts: requirements });
      const response = paymentRequired(malformed ? 'Invalid PAYMENT-SIGNATURE header' : 'Payment required');
      const header = encodeBase64Json(response);
      if (malformed) return { kind: 'invalid', status: 400, response, header };
      if (!payload) return { kind: 'required', response, header };
      const requirement = requirements.find(candidate => matchesRequirement(payload.accepted, candidate));
      if (!requirement) {
        const invalid = paymentRequired('Payment does not match the advertised requirements');
        return { kind: 'invalid', status: 400, response: invalid, header: encodeBase64Json(invalid) };
      }
      const verification = await facilitatorJson(config, 'verify', {
        x402Version: payload.x402Version,
        paymentPayload: payload,
        paymentRequirements: requirement,
      }, signal);
      if (!isRecord(verification) || typeof verification.isValid !== 'boolean') throw new Error('Configured facilitator returned an invalid verification response');
      if (!verification.isValid) {
        const invalid = paymentRequired('Payment verification failed');
        return { kind: 'invalid', status: 402, response: invalid, header: encodeBase64Json(invalid) };
      }
      return { kind: 'authorized', context: { payload, requirement } };
    },

    async settle(context: X402PaymentContext, signal?: AbortSignal) {
      const request = {
        x402Version: context.payload.x402Version,
        paymentPayload: context.payload,
        paymentRequirements: context.requirement,
      };
      let settlement = parseSettlementResponse(await facilitatorJson(config, 'settle', request, signal), context.requirement);
      if (!settlement.success && settlement.errorReason === 'settlement_pending') {
        const pending = settlement;
        try { settlement = parseSettlementResponse(await facilitatorJson(config, 'settle', request, signal), context.requirement); }
        catch { settlement = pending; }
      }
      const buyerFacing = {
        success: settlement.success,
        transaction: settlement.transaction,
        network: settlement.network,
        ...(!settlement.success && settlement.errorReason ? { errorReason: settlement.errorReason } : {}),
        ...(settlement.payer ? { payer: settlement.payer } : {}),
        ...(settlement.amount ? { amount: settlement.amount } : {}),
      };
      return { success: settlement.success, response: buyerFacing, header: encodeBase64Json(buyerFacing) };
    },
  };
}

function parseSettlementResponse(value: unknown, requirement: X402Requirement) {
  if (!isRecord(value) || typeof value.success !== 'boolean' || typeof value.network !== 'string' || typeof value.transaction !== 'string') {
    throw new Error('Configured facilitator returned an invalid settlement response');
  }
  if (value.network !== requirement.network || value.transaction.length > 128 || value.transaction !== '' && !/^0x[0-9a-fA-F]{64}$/.test(value.transaction)) {
    throw new Error('Configured facilitator returned a mismatched settlement response');
  }
  if (value.success && !value.transaction) throw new Error('Configured facilitator returned a successful settlement without a transaction');
  if (!value.success && value.errorReason !== undefined && (typeof value.errorReason !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.errorReason))) {
    throw new Error('Configured facilitator returned an invalid settlement error reason');
  }
  if (!value.success && value.errorReason === 'settlement_pending' && !value.transaction) throw new Error('Configured facilitator returned a pending settlement without a transaction');
  let payer: string | undefined;
  if (value.payer !== undefined) {
    if (typeof value.payer !== 'string') throw new Error('Configured facilitator returned an invalid payer');
    payer = parseEvmAddress(value.payer, 'facilitator payer');
  }
  let amount: string | undefined;
  if (value.amount !== undefined) {
    if (typeof value.amount !== 'string' || value.amount !== requirement.amount) throw new Error('Configured facilitator returned a mismatched settlement amount');
    amount = value.amount;
  }
  return {
    success: value.success,
    transaction: value.transaction,
    network: value.network,
    errorReason: typeof value.errorReason === 'string' ? value.errorReason : undefined,
    payer,
    amount,
  };
}

function makeRequirement(config: X402Config, route: X402Route, network: typeof X402_NETWORKS[number]): X402Requirement {
  return {
    scheme: 'exact',
    network: network.network,
    amount: priceToAtomicUnits(route.price),
    asset: network.asset,
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: { name: network.assetName, version: network.assetVersion },
  };
}

function parseRoutes(value: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new TypeError('PRIORSEAL_X402_ROUTES_JSON must be valid JSON'); }
  assertSafeJson(parsed);
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 64) throw new TypeError('PRIORSEAL_X402_ROUTES_JSON must be an array with 1 to 64 GET routes');
  const seen = new Set<string>();
  return parsed.map((entry, index): X402Route => {
    if (!isRecord(entry) || Object.keys(entry).sort().join(',') !== 'description,method,path,price') throw new TypeError(`x402 route ${index} must contain exactly method, path, description, and price`);
    if (entry.method !== 'GET') throw new TypeError(`x402 route ${index} must use GET so a failed settlement cannot follow a write operation`);
    if (typeof entry.path !== 'string' || !entry.path.startsWith('/v1/') || entry.path.includes('?') || entry.path.includes('#') || entry.path.includes('\\') || entry.path.includes('//')) throw new TypeError(`x402 route ${index} must be a clean /v1/ path pattern`);
    const path = entry.path.replace(/\/$/, '');
    const key = `${entry.method} ${path}`;
    if (seen.has(key)) throw new TypeError(`x402 route ${index} duplicates a previous route`);
    seen.add(key);
    if (path.split('/').some(segment => segment === '.' || segment === '..' || (segment.startsWith(':') && !/^:[A-Za-z][A-Za-z0-9_]*$/.test(segment)))) throw new TypeError(`x402 route ${index} contains an invalid path segment`);
    if (typeof entry.description !== 'string' || !entry.description.trim() || entry.description.length > 300) throw new TypeError(`x402 route ${index} must have a description of at most 300 characters`);
    if (typeof entry.price !== 'string') throw new TypeError(`x402 route ${index} must have a USD price string`);
    priceToAtomicUnits(entry.price);
    const regex = new RegExp(`^${path.split('/').map(segment => segment.startsWith(':') ? '[^/]+' : escapeRegex(segment)).join('/')}/?$`);
    return { method: 'GET', path, description: entry.description.trim(), price: entry.price, regex };
  });
}

function priceToAtomicUnits(price: string) {
  const match = /^\$(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(price);
  if (!match) throw new TypeError('x402 route price must be a positive USD amount such as "$0.01" with at most 6 decimal places');
  const atomic = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
  if (atomic <= 0n || atomic > 9_000_000_000_000_000_000n) throw new TypeError('x402 route price is outside the supported range');
  return atomic.toString();
}

function parseFacilitatorUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('PRIORSEAL_X402_FACILITATOR_URL must be a valid URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new TypeError('PRIORSEAL_X402_FACILITATOR_URL must be HTTPS (HTTP is allowed only for localhost) and must not contain credentials, query, or fragment');
  return url.toString().replace(/\/+$/, '');
}

function parseResourceOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('PRIORSEAL_X402_RESOURCE_ORIGIN must be a valid origin URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new TypeError('PRIORSEAL_X402_RESOURCE_ORIGIN must be an HTTPS origin (HTTP is allowed only for localhost)');
  return url.origin;
}

function parseEvmAddress(value: string, name: string) {
  try { return getAddress(value); } catch { throw new TypeError(`${name} must be a valid EVM address`); }
}

function parseFacilitatorHeaders(value: string | undefined) {
  if (!value) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new TypeError('PRIORSEAL_X402_FACILITATOR_HEADERS_JSON must be valid JSON'); }
  assertSafeJson(parsed);
  if (!isRecord(parsed) || Object.keys(parsed).some(key => !['supported', 'verify', 'settle'].includes(key))) throw new TypeError('PRIORSEAL_X402_FACILITATOR_HEADERS_JSON must contain supported, verify, and/or settle header maps');
  const result: X402Config['facilitatorHeaders'] = {};
  for (const operation of ['supported', 'verify', 'settle'] as const) {
    const headers = parsed[operation];
    if (headers === undefined) continue;
    if (!isRecord(headers) || Object.keys(headers).length > 16) throw new TypeError(`x402 facilitator ${operation} headers must be a small JSON object`);
    const normalized: Record<string, string> = {};
    for (const [name, headerValue] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || RESERVED_FACILITATOR_HEADERS.has(lower) || typeof headerValue !== 'string' || !headerValue.trim() || /[\r\n]/.test(headerValue)) throw new TypeError(`x402 facilitator ${operation} headers contain an invalid or reserved header`);
      normalized[name] = headerValue;
    }
    result[operation] = normalized;
  }
  return result;
}

function parseTimeout(value: string | undefined) {
  if (!value) return 15_000;
  if (!/^\d+$/.test(value)) throw new TypeError('PRIORSEAL_X402_TIMEOUT_MS must be a positive integer');
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > MAX_TIMEOUT_MS) throw new TypeError(`PRIORSEAL_X402_TIMEOUT_MS must be between 1000 and ${MAX_TIMEOUT_MS}`);
  return timeout;
}

async function getSupportedNetworks(config: X402Config, parentSignal?: AbortSignal) {
  const cacheKey = `${config.facilitatorUrl}\n${JSON.stringify(config.facilitatorHeaders.supported ?? {})}`;
  const cached = capabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = facilitatorJson(config, 'supported', undefined, parentSignal).then((value): Set<string> => {
    if (!isRecord(value) || !Array.isArray(value.kinds)) throw new Error('Configured facilitator returned an invalid supported response');
    const kinds = value.kinds as FacilitatorCapability['kinds'];
    for (const kind of kinds) if (!isRecord(kind) || typeof kind.x402Version !== 'number' || typeof kind.scheme !== 'string' || typeof kind.network !== 'string') throw new Error('Configured facilitator returned an invalid supported response');
    return new Set(kinds.filter((kind) => kind.x402Version === 2 && kind.scheme === 'exact').map(kind => (kind as { network: string }).network));
  });
  capabilityCache.set(cacheKey, { expiresAt: Date.now() + 60_000, promise });
  try { return await promise; } catch (error) { capabilityCache.delete(cacheKey); throw error; }
}

async function facilitatorJson(config: X402Config, operation: 'supported' | 'verify' | 'settle', body?: unknown, parentSignal?: AbortSignal): Promise<unknown> {
  const url = operation === 'supported' ? `${config.facilitatorUrl}/supported` : `${config.facilitatorUrl}/${operation}`;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) throw parentSignal.reason;
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Facilitator request timed out')), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method: operation === 'supported' ? 'GET' : 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', ...config.facilitatorHeaders[operation] },
      ...(operation === 'supported' ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const text = await readLimitedText(response, MAX_FACILITATOR_RESPONSE_BYTES);
    if (!response.ok) throw new Error(`Configured facilitator ${operation} failed with HTTP ${response.status}`);
    let result: unknown;
    try { result = JSON.parse(text); } catch { throw new Error(`Configured facilitator ${operation} returned invalid JSON`); }
    assertSafeJson(result);
    return result;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

async function readLimitedText(response: Response, maxBytes: number) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new Error('Configured facilitator response exceeds the allowed size');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('Configured facilitator response exceeds the allowed size'); }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

function decodePaymentHeader(value: string): X402PaymentPayload {
  if (value.length > PAYMENT_HEADER_LIMIT || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError('Invalid PAYMENT-SIGNATURE header');
  const decoded = atob(value);
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new TypeError('Invalid PAYMENT-SIGNATURE header'); }
  assertSafeJson(parsed);
  if (!isRecord(parsed) || parsed.x402Version !== 2 || !isRecord(parsed.accepted) || !isRecord(parsed.payload) || parsed.resource !== undefined && !isRecord(parsed.resource) || parsed.extensions !== undefined && !isRecord(parsed.extensions)) throw new TypeError('Invalid PAYMENT-SIGNATURE payload');
  const accepted = parsed.accepted;
  if (accepted.scheme !== 'exact' || typeof accepted.network !== 'string' || typeof accepted.amount !== 'string' || typeof accepted.asset !== 'string' || typeof accepted.payTo !== 'string' || !Number.isSafeInteger(accepted.maxTimeoutSeconds) || !isRecord(accepted.extra)) throw new TypeError('Invalid PAYMENT-SIGNATURE accepted requirements');
  return parsed as unknown as X402PaymentPayload;
}

function matchesRequirement(accepted: X402Requirement, requirement: X402Requirement) {
  return accepted.scheme === requirement.scheme && accepted.network === requirement.network && accepted.amount === requirement.amount && accepted.asset.toLowerCase() === requirement.asset.toLowerCase() && accepted.payTo.toLowerCase() === requirement.payTo.toLowerCase() && accepted.maxTimeoutSeconds === requirement.maxTimeoutSeconds && accepted.extra.name === requirement.extra.name && accepted.extra.version === requirement.extra.version && Object.keys(accepted.extra).length === 2;
}

function encodeBase64Json(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function optional(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
