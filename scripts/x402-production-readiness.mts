/**
 * Performs a no-payment verification of an already configured production x402
 * route. It deliberately issues only GET requests without PAYMENT-SIGNATURE:
 * facilitator capability discovery, public capabilities, and an HTTP 402
 * quote. It cannot authorize, settle, or broadcast a payment.
 */
import { loadRuntimeConfig } from '../src/bootstrap/runtime-config.mjs';
import { createX402PaymentService } from '../src/infrastructure/payments/x402-exact-evm.mjs';
import { pathToFileURL } from 'node:url';

const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;

export async function runX402ProductionReadiness(environment: NodeJS.ProcessEnv = process.env, log: (message: string) => void = console.log) {
  if (environment.PRIORSEAL_ENVIRONMENT !== 'production') throw new TypeError('Set PRIORSEAL_ENVIRONMENT=production before running the x402 production readiness check');
  const config = loadRuntimeConfig(environment);
  if (!config.x402 || !config.x402.networksExplicitlyConfigured || !config.x402.networks.length) throw new TypeError('Production x402 readiness requires an explicitly configured payment allowlist');
  if (config.x402.testnetNetworksEnabled || config.x402.networks.some(network => network === 'eip155:84532')) throw new TypeError('Production x402 readiness rejects testnet payment rails');

  const x402 = config.x402;
  const probePath = x402.routes[0].path.replace(/:[A-Za-z][A-Za-z0-9_]*/g, 'x402-production-probe');
  const probeResourceUrl = new URL(probePath, x402.resourceOrigin).toString();
  const localChallenge = await createX402PaymentService(x402).prepare(x402.routes[0], probeResourceUrl, undefined, AbortSignal.timeout(TIMEOUT_MS));
  if (localChallenge.kind !== 'required') throw new TypeError('Local production x402 probe did not produce a payment challenge');

  const capabilities = await readJson(new URL('/v1/capabilities', x402.resourceOrigin).toString());
  const payments = nested(capabilities.body, ['payments', 'x402']);
  if (!payments || payments.configured !== true) throw new TypeError('Production API does not report x402 as configured');
  assertExactNetworks(networksFromCapabilities(payments), x402.networks, 'production API capabilities');
  assertRoutes(payments.routes, x402.routes);

  const remoteChallenge = await readJson(probeResourceUrl, { expectStatus: 402 });
  if (remoteChallenge.headers.has('payment-response')) throw new TypeError('Unpaid production x402 probe unexpectedly returned PAYMENT-RESPONSE');
  const encodedHeader = remoteChallenge.headers.get('payment-required');
  if (!encodedHeader) throw new TypeError('Production x402 payment challenge is missing PAYMENT-REQUIRED');
  assertEquivalentChallenges(localChallenge.response, remoteChallenge.body, probeResourceUrl);
  assertEquivalentChallenges(decodeBase64Json(encodedHeader, 'PAYMENT-REQUIRED'), remoteChallenge.body, probeResourceUrl);

  log(JSON.stringify({
    ready: true,
    environment: config.environment,
    resourceOrigin: new URL(x402.resourceOrigin).origin,
    route: x402.routes[0].path,
    networks: [...x402.networks].sort(),
    checks: ['facilitator-supported', 'production-capabilities', 'production-402-challenge', 'payment-required-header-match'],
    settlementAttempted: false,
  }));
}

async function readJson(url: string, { expectStatus = 200 }: { expectStatus?: number } = {}) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status !== expectStatus) throw new TypeError(`Production x402 readiness probe received HTTP ${response.status}, expected ${expectStatus}`);
  const text = await readLimitedText(response);
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { throw new TypeError('Production x402 readiness probe returned invalid JSON'); }
  if (!isRecord(body)) throw new TypeError('Production x402 readiness probe returned a non-object JSON body');
  return { body, headers: response.headers };
}

async function readLimitedText(response: Response) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) throw new TypeError('Production x402 readiness response exceeds the size limit');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new TypeError('Production x402 readiness response exceeds the size limit'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function assertEquivalentChallenges(expected: Record<string, unknown>, actual: Record<string, unknown>, resourceUrl: string) {
  if (expected.x402Version !== 2 || actual.x402Version !== 2 || expected.error !== 'Payment required' || actual.error !== 'Payment required') throw new TypeError('Production x402 challenge has an unexpected envelope');
  const expectedResource = requireRecord(expected.resource, 'Local payment resource is invalid');
  const actualResource = requireRecord(actual.resource, 'Production payment resource is invalid');
  if (expectedResource.url !== resourceUrl || actualResource.url !== resourceUrl || JSON.stringify(expectedResource) !== JSON.stringify(actualResource)) throw new TypeError('Production x402 challenge resource differs from the configured route');
  const expectedAccepts = normalizedRequirements(expected.accepts);
  const actualAccepts = normalizedRequirements(actual.accepts);
  if (JSON.stringify(expectedAccepts) !== JSON.stringify(actualAccepts)) throw new TypeError('Production x402 challenge requirements differ from the configured facilitator quote');
}

function normalizedRequirements(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new TypeError('x402 payment challenge has no accepted requirements');
  return value.map((entry) => {
    const requirement = requireRecord(entry, 'x402 payment challenge contains an invalid requirement');
    if (requirement.scheme !== 'exact' || typeof requirement.network !== 'string' || typeof requirement.amount !== 'string' || !/^\d+$/.test(requirement.amount) || typeof requirement.asset !== 'string' || typeof requirement.payTo !== 'string' || !Number.isSafeInteger(requirement.maxTimeoutSeconds) || !isRecord(requirement.extra) || !Object.values(requirement.extra).every(item => typeof item === 'string')) throw new TypeError('x402 payment challenge contains an invalid requirement');
    return { scheme: requirement.scheme, network: requirement.network, amount: requirement.amount, asset: requirement.asset, payTo: requirement.payTo, maxTimeoutSeconds: requirement.maxTimeoutSeconds, extra: Object.fromEntries(Object.entries(requirement.extra).sort(([left], [right]) => left.localeCompare(right))) };
  }).sort((left, right) => left.network.localeCompare(right.network));
}

function networksFromCapabilities(value: Record<string, unknown>) {
  const networks = value.networks;
  if (!Array.isArray(networks)) throw new TypeError('Production API x402 capabilities have no network list');
  return networks.map((entry) => {
    const network = requireRecord(entry, 'Production API x402 capabilities contain an invalid network');
    if (typeof network.network !== 'string') throw new TypeError('Production API x402 capabilities contain an invalid network');
    return network.network;
  });
}

function assertExactNetworks(actual: string[], expected: string[], source: string) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (new Set(normalizedActual).size !== normalizedActual.length || normalizedActual.length !== normalizedExpected.length || normalizedActual.some((network, index) => network !== normalizedExpected[index])) throw new TypeError(`${source} does not exactly match the configured x402 allowlist`);
}

function assertRoutes(value: unknown, expected: { method: string; path: string; description: string; price: string }[]) {
  if (!Array.isArray(value) || value.length !== expected.length) throw new TypeError('Production API x402 capabilities have an unexpected paid-route schedule');
  for (let index = 0; index < expected.length; index += 1) {
    const route = requireRecord(value[index], 'Production API x402 capabilities contain an invalid paid route');
    const configured = expected[index];
    if (route.method !== configured.method || route.path !== configured.path || route.description !== configured.description || route.price !== configured.price) throw new TypeError('Production API x402 capabilities paid-route schedule differs from configuration');
  }
}

function decodeBase64Json(header: string, name: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as unknown; }
  catch { throw new TypeError(`${name} header is not base64 JSON`); }
  return requireRecord(parsed, `${name} header is not a JSON object`);
}

function nested(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return isRecord(current) ? current : null;
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requireRecord(value: unknown, message: string): Record<string, unknown> { if (!isRecord(value)) throw new TypeError(message); return value; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runX402ProductionReadiness();
