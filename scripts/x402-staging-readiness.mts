import { loadRuntimeConfig } from '../src/bootstrap/runtime-config.mjs';
import { X402_STAGING_NETWORKS, createX402PaymentService } from '../src/infrastructure/payments/x402-exact-evm.mjs';
import { createRpcClient } from '../src/infrastructure/blockchain/evm/rpc-client.mjs';
import { getRpcUrls } from '../src/infrastructure/blockchain/evm/chains.mjs';
import { SOLANA_MAINNET_CAIP2 } from '../src/domain/solana.mjs';

const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;

if (process.env.PRIORSEAL_ENVIRONMENT !== 'staging') throw new TypeError('Set PRIORSEAL_ENVIRONMENT=staging before running the x402 staging readiness check');
const config = loadRuntimeConfig();
if (!config.x402 || !config.x402.networksExplicitlyConfigured || !config.x402.networks.length) throw new TypeError('Staging x402 readiness requires an explicit PRIORSEAL_X402_NETWORKS allowlist');

const x402 = config.x402;
const expectedNetworks = [...x402.networks].sort();
const observationNetworks = parseObservationNetworks(process.env.PRIORSEAL_X402_STAGING_OBSERVATION_NETWORKS, expectedNetworks);
const probePath = x402.routes[0].path.replace(/:[A-Za-z][A-Za-z0-9_]*/g, 'staging-probe');
const probeResourceUrl = new URL(probePath, x402.resourceOrigin).toString();

// This requests only a 402 quote. It never provides PAYMENT-SIGNATURE and
// cannot call /verify or /settle.
const localChallenge = await createX402PaymentService(x402).prepare(x402.routes[0], probeResourceUrl, undefined, AbortSignal.timeout(TIMEOUT_MS));
if (localChallenge.kind !== 'required') throw new TypeError('Local x402 staging probe did not produce a payment challenge');
assertExactNetworks(networksFromAccepts(localChallenge.response), expectedNetworks, 'configured facilitator');

const capabilitiesUrl = new URL('/v1/capabilities', x402.resourceOrigin).toString();
const capabilities = await readJson(capabilitiesUrl);
const paymentCapabilities = nested(capabilities.body, ['payments', 'x402']);
if (!paymentCapabilities || paymentCapabilities.configured !== true) throw new TypeError('Staging API does not report x402 as configured');
assertExactNetworks(networksFromCapabilities(paymentCapabilities), expectedNetworks, 'staging API capabilities');

const stagedChallenge = await readJson(probeResourceUrl, { expectStatus: 402 });
assertExactNetworks(networksFromAccepts(stagedChallenge.body), expectedNetworks, 'staging API payment challenge');
if (!stagedChallenge.headers.get('payment-required')) throw new TypeError('Staging API payment challenge is missing PAYMENT-REQUIRED');

await Promise.all(observationNetworks.map(verifyObservationRpc));

console.log(JSON.stringify({
  ready: true,
  environment: config.environment,
  resourceOrigin: new URL(x402.resourceOrigin).origin,
  route: x402.routes[0].path,
  networks: expectedNetworks,
  observationNetworks,
  checks: ['facilitator-supported', 'staging-capabilities', 'staging-402-challenge', ...(observationNetworks.length ? ['observation-rpc-identity'] : [])],
  settlementAttempted: false,
}));

async function readJson(url: string, { expectStatus = 200 }: { expectStatus?: number } = {}) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status !== expectStatus) throw new TypeError(`Staging readiness probe received HTTP ${response.status}, expected ${expectStatus}`);
  const text = await readLimitedText(response);
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { throw new TypeError('Staging readiness probe returned invalid JSON'); }
  if (!record(body)) throw new TypeError('Staging readiness probe returned a non-object JSON body');
  return { body, headers: response.headers };
}

async function readLimitedText(response: Response) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) throw new TypeError('Staging readiness response exceeds the size limit');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new TypeError('Staging readiness response exceeds the size limit'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function networksFromAccepts(value: Record<string, unknown>) {
  const accepts = value.accepts;
  if (!Array.isArray(accepts) || !accepts.length) throw new TypeError('x402 payment challenge has no accepted networks');
  return accepts.map((entry) => {
    if (!record(entry) || typeof entry.network !== 'string') throw new TypeError('x402 payment challenge contains an invalid accepted network');
    return entry.network;
  });
}

function networksFromCapabilities(value: Record<string, unknown>) {
  const networks = value.networks;
  if (!Array.isArray(networks)) throw new TypeError('Staging API x402 capabilities have no network list');
  return networks.map((entry) => {
    if (!record(entry) || typeof entry.network !== 'string') throw new TypeError('Staging API x402 capabilities contain an invalid network');
    return entry.network;
  });
}

function assertExactNetworks(actual: string[], expected: string[], source: string) {
  const normalized = [...actual].sort();
  if (new Set(normalized).size !== normalized.length || normalized.length !== expected.length || normalized.some((network, index) => network !== expected[index])) throw new TypeError(`${source} does not exactly match the staged PRIORSEAL_X402_NETWORKS allowlist`);
}

function parseObservationNetworks(value: string | undefined, allowed: string[]) {
  if (!value?.trim()) return [];
  const selected = value.split(',').map(network => network.trim());
  if (!selected.length || selected.some(network => !network) || new Set(selected).size !== selected.length || selected.some(network => !allowed.includes(network))) throw new TypeError('PRIORSEAL_X402_STAGING_OBSERVATION_NETWORKS must be a unique subset of PRIORSEAL_X402_NETWORKS');
  return selected.sort();
}

async function verifyObservationRpc(network: string) {
  const configured = X402_STAGING_NETWORKS.find(candidate => candidate.network === network);
  if (!configured) throw new TypeError(`Unknown x402 observation network: ${network}`);
  const urls = getRpcUrls(configured.chainId);
  if (!urls?.length) throw new TypeError(`No observation RPC is configured for ${network}`);
  if (network === SOLANA_MAINNET_CAIP2) {
    await Promise.all(urls.map(async (url) => {
      const result = await rpcJson(url, 'getGenesisHash', []);
      if (result !== SOLANA_MAINNET_CAIP2.slice('solana:'.length)) throw new TypeError(`Configured RPC does not match ${network}`);
    }));
    return;
  }
  const client = createRpcClient({ timeoutMs: TIMEOUT_MS, retries: 0 });
  await Promise.all(urls.map(async (url) => {
    const reported = await client.call<string>(url, 'eth_chainId', []);
    if (Number(BigInt(reported)) !== configured.chainId) throw new TypeError(`Configured RPC does not match ${network}`);
  }));
}

async function rpcJson(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'priorseal-x402-staging', method, params }), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new TypeError(`Configured Solana RPC returned HTTP ${response.status}`);
  const text = await readLimitedText(response);
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { throw new TypeError('Configured Solana RPC returned invalid JSON'); }
  if (!record(body) || body.jsonrpc !== '2.0' || body.id !== 'priorseal-x402-staging' || body.error !== undefined || typeof body.result !== 'string') throw new TypeError('Configured Solana RPC returned an invalid response');
  return body.result;
}

function nested(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!record(current)) return null;
    current = current[key];
  }
  return record(current) ? current : null;
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
