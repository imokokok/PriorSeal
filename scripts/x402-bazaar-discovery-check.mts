/**
 * Reads the public PriorSeal paid-route schedule and the CDP Bazaar catalog.
 * It never constructs PAYMENT-SIGNATURE, invokes /verify or /settle, or
 * transmits a wallet credential. CDP API-key authentication only authorizes
 * this read-only catalog query.
 */
import { pathToFileURL } from 'node:url';
import { CDP_X402_DISCOVERY_SEARCH_URL, CDP_X402_FACILITATOR_URL, cdpApiAuthHeaders, parseCdpFacilitatorAuth } from '../src/infrastructure/payments/cdp-facilitator-auth.mjs';

const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;
const BAZAAR_SERVICE = Object.freeze({
  serviceName: 'PriorSeal Evidence API',
  tags: ['agent-evidence', 'authorization', 'execution', 'verification', 'x402'],
  iconPath: '/priorseal-mark.svg',
});

type PaidRoute = { method: 'GET'; path: string };
type BazaarDiscoveryEnvironment = Partial<Record<'PRIORSEAL_X402_RESOURCE_ORIGIN' | 'PRIORSEAL_X402_CDP_API_KEY_ID' | 'PRIORSEAL_X402_CDP_API_KEY_SECRET', string>>;

export async function runX402BazaarDiscoveryCheck(environment: BazaarDiscoveryEnvironment = process.env, log: (message: string) => void = console.log) {
  const resourceOrigin = parseResourceOrigin(environment.PRIORSEAL_X402_RESOURCE_ORIGIN ?? 'https://priorseal.xyz');
  const auth = parseCdpFacilitatorAuth({
    apiKeyId: environment.PRIORSEAL_X402_CDP_API_KEY_ID,
    apiKeySecret: environment.PRIORSEAL_X402_CDP_API_KEY_SECRET,
    facilitatorUrl: CDP_X402_FACILITATOR_URL,
    hasStaticHeaders: false,
  });
  const capabilities = await readJson(new URL('/v1/capabilities', resourceOrigin).toString(), 'PriorSeal capabilities');
  const routes = paidRoutes(capabilities);
  const endpoint = new URL(CDP_X402_DISCOVERY_SEARCH_URL);
  endpoint.searchParams.set('urlSubstring', new URL(resourceOrigin).hostname);
  endpoint.searchParams.set('extensions', 'bazaar');
  endpoint.searchParams.set('limit', '100');
  const headers = await cdpApiAuthHeaders(auth, 'GET', endpoint);
  const catalog = await readJson(endpoint.toString(), 'CDP Bazaar catalog', headers);
  const listed = catalogResources(catalog);
  const missing = routes.filter(route => !listed.some(entry => matchesCatalogEntry(entry, route, resourceOrigin)));
  if (missing.length) {
    throw new TypeError(`CDP Bazaar has not yet listed these PriorSeal route templates: ${missing.map(route => route.path).join(', ')}. Complete one valid x402 payment with the Bazaar extension echoed from PAYMENT-REQUIRED, then wait for CDP indexing before retrying this read-only check.`);
  }
  log(JSON.stringify({
    listed: true,
    resourceOrigin,
    routes: routes.map(route => route.path),
    checks: ['production-capabilities', 'cdp-bazaar-catalog', 'bazaar-service-metadata', 'bazaar-input-output-schema'],
    paymentAttempted: false,
    settlementAttempted: false,
  }));
}

function parseResourceOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('PRIORSEAL_X402_RESOURCE_ORIGIN must be a valid HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('PRIORSEAL_X402_RESOURCE_ORIGIN must be a valid HTTPS origin');
  return url.origin;
}

async function readJson(url: string, label: string, headers?: Record<string, string>) {
  const response = await fetch(url, { method: 'GET', redirect: 'manual', headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status >= 300 && response.status < 400) throw new TypeError(`${label} attempted an unexpected redirect`);
  if (!response.ok) throw new TypeError(`${label} returned HTTP ${response.status}`);
  const text = await readLimitedText(response, label);
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { throw new TypeError(`${label} returned invalid JSON`); }
  return requireRecord(body, `${label} returned a non-object JSON body`);
}

async function readLimitedText(response: Response, label: string) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) throw new TypeError(`${label} response exceeds the size limit`);
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new TypeError(`${label} response exceeds the size limit`); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function paidRoutes(capabilities: Record<string, unknown>): PaidRoute[] {
  const payments = requireRecord(capabilities.payments, 'PriorSeal capabilities do not expose payments');
  const x402 = requireRecord(payments.x402, 'PriorSeal capabilities do not expose x402');
  if (x402.configured !== true) throw new TypeError('PriorSeal capabilities do not report x402 as configured');
  if (!Array.isArray(x402.routes) || !x402.routes.length) throw new TypeError('PriorSeal capabilities do not expose a paid x402 route schedule');
  const configured = x402.routes.map((value) => {
    const route = requireRecord(value, 'PriorSeal capabilities contain an invalid x402 route');
    if (route.method !== 'GET' || typeof route.path !== 'string') throw new TypeError('PriorSeal capabilities contain an invalid x402 route');
    return paidRoute(route.path);
  });
  const commerce = optionalEvidenceCommerce(capabilities);
  if (!commerce) return configured;
  if (commerce.enabled !== true || typeof commerce.paymentPath !== 'string' || !Array.isArray(commerce.staticExportPaths) || !commerce.staticExportPaths.every(path => typeof path === 'string')) throw new TypeError('PriorSeal capabilities contain invalid Evidence API x402 metadata');
  const derived = [...commerce.staticExportPaths, commerce.paymentPath].map(path => paidRoute(path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, ':$1')));
  return [...new Map([...configured, ...derived].map(route => [route.path, route])).values()];
}

function optionalEvidenceCommerce(capabilities: Record<string, unknown>) {
  if (capabilities.evidenceApi === undefined) return undefined;
  const evidenceApi = requireRecord(capabilities.evidenceApi, 'PriorSeal capabilities contain invalid Evidence API metadata');
  const commerce = requireRecord(evidenceApi.commerce, 'PriorSeal capabilities contain invalid Evidence API commerce metadata');
  const x402 = requireRecord(commerce.x402, 'PriorSeal capabilities contain invalid Evidence API x402 metadata');
  return x402;
}

function paidRoute(path: string): PaidRoute {
  if (!/^\/[A-Za-z0-9_/:.\-~%]+$/.test(path) || path.includes('..') || path.includes('://')) throw new TypeError('PriorSeal capabilities contain an invalid x402 route');
  return { method: 'GET', path };
}

function catalogResources(catalog: Record<string, unknown>) {
  if (!Array.isArray(catalog.resources)) throw new TypeError('CDP Bazaar catalog did not return a resources array');
  return catalog.resources.map((value) => requireRecord(value, 'CDP Bazaar catalog contains an invalid resource'));
}

function matchesCatalogEntry(entry: Record<string, unknown>, route: PaidRoute, resourceOrigin: string) {
  try {
    const fields = catalogResourceFields(entry);
    if (typeof fields.url !== 'string' || new URL(fields.url).origin !== resourceOrigin) return false;
    if (fields.serviceName !== BAZAAR_SERVICE.serviceName || JSON.stringify(fields.tags) !== JSON.stringify(BAZAAR_SERVICE.tags)) return false;
    if (fields.iconUrl !== undefined && fields.iconUrl !== new URL(BAZAAR_SERVICE.iconPath, resourceOrigin).toString()) return false;
    const extensions = requireRecord(entry.extensions, 'CDP Bazaar catalog contains a resource without extensions');
    const bazaar = requireRecord(extensions.bazaar, 'CDP Bazaar catalog contains a resource without Bazaar metadata');
    const expectedPathParams = examplePathParams(route.path, fields.url);
    const hasPathParams = Object.keys(expectedPathParams).length > 0;
    if (hasPathParams && bazaar.routeTemplate !== route.path) return false;
    if (!hasPathParams && (bazaar.routeTemplate !== undefined || new URL(fields.url).pathname.replace(/\/+$/, '') !== route.path)) return false;
    const info = requireRecord(bazaar.info, 'CDP Bazaar entry has invalid discovery info');
    const input = requireRecord(info.input, 'CDP Bazaar entry has invalid input metadata');
    const output = requireRecord(info.output, 'CDP Bazaar entry has invalid output metadata');
    const schema = requireRecord(bazaar.schema, 'CDP Bazaar entry has invalid schema metadata');
    if (input.type !== 'http' || input.method !== route.method) return false;
    if (hasPathParams && JSON.stringify(input.pathParams) !== JSON.stringify(expectedPathParams)) return false;
    if (!hasPathParams && !isRecord(input.queryParams)) return false;
    if (output.type !== 'json' || output.format !== outputFormat(route.path) || !isRecord(output.example)) return false;
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || schema.type !== 'object' || !Array.isArray(schema.required) || !schema.required.includes('input') || !isRecord(schema.properties)) return false;
    const inputSchema = requireRecord(schema.properties.input, 'CDP Bazaar entry has an invalid input schema');
    if (!Array.isArray(inputSchema.required) || !inputSchema.required.includes('type') || !inputSchema.required.includes('method')) return false;
    return hasPathParams ? inputSchema.required.includes('pathParams') : inputSchema.required.includes('queryParams');
  } catch {
    // Other marketplace entries must not prevent inspection of PriorSeal's own
    // listing; they simply do not match the strict PriorSeal contract.
    return false;
  }
}

/**
 * CDP's discovery search returns a flat entry whose resource field is the bare
 * resource URL string and whose service metadata sits beside it; the documented
 * shape nests them under a resource object. Accept both.
 */
function catalogResourceFields(entry: Record<string, unknown>) {
  if (typeof entry.resource === 'string') return { url: entry.resource, serviceName: entry.serviceName, tags: entry.tags, iconUrl: entry.iconUrl };
  const resource = requireRecord(entry.resource, 'CDP Bazaar catalog contains a resource without metadata');
  return { url: resource.url, serviceName: resource.serviceName, tags: resource.tags, iconUrl: resource.iconUrl };
}

function examplePathParams(routeTemplate: string, resourceUrl: string) {
  const template = routeTemplate.replace(/\/+$/, '').split('/');
  const path = new URL(resourceUrl).pathname.replace(/\/+$/, '').split('/');
  const result: Record<string, string> = {};
  for (let index = 0; index < template.length; index += 1) {
    if (!template[index].startsWith(':')) continue;
    if (!path[index]) return result;
    result[template[index].slice(1)] = decodeURIComponent(path[index]);
  }
  return result;
}

function outputFormat(path: string) {
  if (path.endsWith('/bundle')) return 'priorseal.verification-bundle.v1';
  if (path.endsWith('/check')) return 'priorseal.fresh-evidence-check.v1';
  if (path.startsWith('/v1/evidence/receipts/')) return 'priorseal.evidence.v1';
  if (path === '/v1/integration-readiness') return 'priorseal.integration-readiness.v1';
  return 'application/json';
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requireRecord(value: unknown, message: string): Record<string, unknown> { if (!isRecord(value)) throw new TypeError(message); return value; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runX402BazaarDiscoveryCheck();
