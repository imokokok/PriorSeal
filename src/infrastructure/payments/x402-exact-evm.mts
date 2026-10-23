import { getAddress } from 'viem';
import { assertSafeJson } from '../../shared/safe-json.mjs';
import { decodeBase58, isSolanaPublicKey, SOLANA_MAINNET_CAIP2 } from '../../domain/solana.mjs';
import { CDP_X402_FACILITATOR_URL, cdpFacilitatorAuthHeaders, parseCdpFacilitatorAuth, type CdpFacilitatorAuth } from './cdp-facilitator-auth.mjs';

/**
 * Payment networks deliberately mirror Insight's production x402 rails.
 * A route advertises only networks enabled by local payee configuration and
 * currently reported by its facilitator; listing a network here is not a
 * claim that its RPC observation, ERC-4337, Safe, or EIP-7702 profiles are
 * enabled for a deployment.
 */
/**
 * `assetDecimals` defaults to 6 (Circle USDC). Deviating tokens must declare
 * it explicitly so requirement amounts land on the token's atomic-unit grid.
 */
export const X402_EVM_NETWORKS = Object.freeze([
  { family: 'evm', network: 'eip155:1', chainId: 1, name: 'Ethereum', asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', assetName: 'USD Coin', assetVersion: '2' },
  { family: 'evm', network: 'eip155:8453', chainId: 8453, name: 'Base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', assetName: 'USD Coin', assetVersion: '2' },
  { family: 'evm', network: 'eip155:10', chainId: 10, name: 'OP Mainnet', asset: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', assetName: 'USD Coin', assetVersion: '2' },
  { family: 'evm', network: 'eip155:42161', chainId: 42161, name: 'Arbitrum One', asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', assetName: 'USD Coin', assetVersion: '2' },
  { family: 'evm', network: 'eip155:137', chainId: 137, name: 'Polygon PoS', asset: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', assetName: 'USD Coin', assetVersion: '2' },
  { family: 'evm', network: 'eip155:43114', chainId: 43114, name: 'Avalanche C-Chain', asset: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', assetName: 'USD Coin', assetVersion: '2' },
  { family: 'evm', network: 'eip155:1329', chainId: 1329, name: 'Sei', asset: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392', assetName: 'USD Coin', assetVersion: '2' },
  { family: 'evm', network: 'eip155:196', chainId: 196, name: 'X Layer', asset: '0xB6CEceAB302E2E4948951eE7843FC24E92933061', assetName: 'USD Coin', assetVersion: '2' },
  { family: 'evm', network: 'eip155:143', chainId: 143, name: 'Monad', asset: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', assetName: 'USDC', assetVersion: '2' },
  {
    family: 'evm',
    network: 'eip155:56',
    chainId: 56,
    name: 'BNB Smart Chain',
    /** Binance-bridged USDC (18 decimals) as listed by the AEON facilitator's exact v2 registry (verified 2026-10-17 in Insight production). */
    asset: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    assetName: 'USD Coin',
    assetVersion: '2',
    assetDecimals: 18,
  },
] as const);

export const X402_SOLANA_NETWORKS = Object.freeze([
  { family: 'svm', network: SOLANA_MAINNET_CAIP2, chainId: 0, name: 'Solana mainnet-beta', asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', assetName: 'USDC' },
] as const);

/**
 * Staging-only rails are deliberately separate from the production registry.
 * They still require an explicit environment flag and allowlist, so a
 * production deployment cannot accidentally advertise testnet USDC.
 */
export const X402_STAGING_EVM_NETWORKS = Object.freeze([
  { family: 'evm', network: 'eip155:84532', chainId: 84532, name: 'Base Sepolia', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', assetName: 'USDC', assetVersion: '2' },
] as const);

export const X402_NETWORKS = Object.freeze([...X402_EVM_NETWORKS, ...X402_SOLANA_NETWORKS]);
export const X402_STAGING_NETWORKS = Object.freeze([...X402_NETWORKS, ...X402_STAGING_EVM_NETWORKS]);

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
  extra: Record<string, string>;
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
  /** Per-network facilitator overrides parsed from PRIORSEAL_X402_FACILITATOR_URLS; absent when every rail shares the default facilitator. */
  facilitatorUrls?: Readonly<Record<string, string>>;
  facilitatorHeaders: Partial<Record<'supported' | 'verify' | 'settle', Record<string, string>>>;
  facilitatorAuth?: CdpFacilitatorAuth;
  resourceOrigin: string;
  /** Shared EVM recipient; absent when a deployment accepts Solana only. */
  payTo?: string;
  /** Solana merchant public key; absent when a deployment accepts EVM only. */
  solanaPayTo?: string;
  /** Explicit production rollout selection; defaults to every known rail only outside deployment validation. */
  networks: string[];
  networksExplicitlyConfigured: boolean;
  /** Enables only the separately declared testnet registry in staging, test, or development. */
  testnetNetworksEnabled: boolean;
  timeoutMs: number;
  routes: X402Route[];
};

type X402Environment = Partial<Record<
  'PRIORSEAL_X402_FACILITATOR_URL' | 'PRIORSEAL_X402_FACILITATOR_URLS' | 'PRIORSEAL_X402_FACILITATOR_HEADERS_JSON' |
  'PRIORSEAL_X402_FACILITATOR_AUTH_MODE' | 'PRIORSEAL_X402_CDP_API_KEY_ID' | 'PRIORSEAL_X402_CDP_API_KEY_SECRET' |
  'PRIORSEAL_X402_RESOURCE_ORIGIN' | 'PRIORSEAL_X402_PAY_TO' |
  'PRIORSEAL_X402_SOLANA_PAY_TO' |
  'PRIORSEAL_X402_NETWORKS' |
  'PRIORSEAL_X402_ENABLE_TESTNETS' |
  'PRIORSEAL_ENVIRONMENT' |
  'PRIORSEAL_X402_TIMEOUT_MS' | 'PRIORSEAL_X402_ROUTES_JSON', string
>>;

export type X402PaymentContext = { payload: X402PaymentPayload; requirement: X402Requirement };
export type X402Settlement = { success: boolean; transaction: string; network: string; errorReason?: string; payer?: string; amount?: string };
export type X402NetworkDescriptor = { family: 'evm' | 'svm'; network: string; chainId: number; name: string; asset: string; assetName: string };

const BAZAAR_SERVICE = Object.freeze({
  serviceName: 'PriorSeal Evidence API',
  tags: ['agent-evidence', 'authorization', 'execution', 'verification', 'x402'],
  iconUrl: '/priorseal-mark.svg',
});

type FacilitatorKind = { x402Version: number; scheme: string; network: string; extra?: unknown };
type FacilitatorCapability = { kinds: FacilitatorKind[]; signers?: Record<string, string[]> };
type ParsedFacilitatorSupport = { networks: Set<string>; solanaFeePayers: ReadonlyMap<string, string> };
type FacilitatorSupport = { networks: Set<string>; solanaFeePayer: string | null };

const capabilityCache = new Map<string, { expiresAt: number; promise: Promise<FacilitatorSupport> }>();

/** Parse opt-in x402 settings at the runtime boundary. No payment routes are active by default. */
export function parseX402Config(environment: X402Environment): X402Config | undefined {
  const raw = {
    facilitatorUrl: optional(environment.PRIORSEAL_X402_FACILITATOR_URL),
    facilitatorUrls: optional(environment.PRIORSEAL_X402_FACILITATOR_URLS),
    facilitatorHeadersJson: optional(environment.PRIORSEAL_X402_FACILITATOR_HEADERS_JSON),
    facilitatorAuthMode: optional(environment.PRIORSEAL_X402_FACILITATOR_AUTH_MODE),
    cdpApiKeyId: optional(environment.PRIORSEAL_X402_CDP_API_KEY_ID),
    cdpApiKeySecret: optional(environment.PRIORSEAL_X402_CDP_API_KEY_SECRET),
    resourceOrigin: optional(environment.PRIORSEAL_X402_RESOURCE_ORIGIN),
    payTo: optional(environment.PRIORSEAL_X402_PAY_TO),
    solanaPayTo: optional(environment.PRIORSEAL_X402_SOLANA_PAY_TO),
    networks: optional(environment.PRIORSEAL_X402_NETWORKS),
    enableTestnets: optional(environment.PRIORSEAL_X402_ENABLE_TESTNETS),
    timeoutMs: optional(environment.PRIORSEAL_X402_TIMEOUT_MS),
    routesJson: optional(environment.PRIORSEAL_X402_ROUTES_JSON),
  };
  if (!Object.entries(raw).some(([key, value]) => key !== 'enableTestnets' && Boolean(value))) return undefined;
  for (const field of ['facilitatorUrl', 'resourceOrigin', 'routesJson'] as const) {
    if (!raw[field]) throw new TypeError(`PRIORSEAL_X402_${field === 'routesJson' ? 'ROUTES_JSON' : field === 'facilitatorUrl' ? 'FACILITATOR_URL' : field === 'resourceOrigin' ? 'RESOURCE_ORIGIN' : 'PAY_TO'} is required when x402 is configured`);
  }
  if (!raw.payTo && !raw.solanaPayTo) throw new TypeError('PRIORSEAL_X402_PAY_TO or PRIORSEAL_X402_SOLANA_PAY_TO is required when x402 is configured');

  const facilitatorUrl = parseFacilitatorUrl(raw.facilitatorUrl!);
  const facilitatorUrls = parseFacilitatorUrls(raw.facilitatorUrls);
  const resourceOrigin = parseResourceOrigin(raw.resourceOrigin!);
  const payTo = raw.payTo ? parseEvmAddress(raw.payTo, 'PRIORSEAL_X402_PAY_TO') : undefined;
  const solanaPayTo = raw.solanaPayTo ? parseSolanaPublicKey(raw.solanaPayTo, 'PRIORSEAL_X402_SOLANA_PAY_TO') : undefined;
  const testnetNetworksEnabled = parseTestnetNetworkFlag(raw.enableTestnets, environment.PRIORSEAL_ENVIRONMENT);
  const networkSelection = parseNetworkSelection(raw.networks, testnetNetworksEnabled);
  if (networkSelection.networksExplicitlyConfigured && networkSelection.networks.some(network => network.startsWith('eip155:')) && !payTo) throw new TypeError('PRIORSEAL_X402_NETWORKS selects an EVM payment rail but PRIORSEAL_X402_PAY_TO is not configured');
  if (networkSelection.networksExplicitlyConfigured && networkSelection.networks.includes(SOLANA_MAINNET_CAIP2) && !solanaPayTo) throw new TypeError('PRIORSEAL_X402_NETWORKS selects Solana but PRIORSEAL_X402_SOLANA_PAY_TO is not configured');
  const timeoutMs = parseTimeout(raw.timeoutMs);
  const facilitatorHeaders = parseFacilitatorHeaders(raw.facilitatorHeadersJson);
  const facilitatorAuth = parseFacilitatorAuth(raw.facilitatorAuthMode, raw.cdpApiKeyId, raw.cdpApiKeySecret, facilitatorUrl, Boolean(raw.facilitatorHeadersJson));
  const routes = parseRoutes(raw.routesJson!);
  return { facilitatorUrl, ...(facilitatorUrls ? { facilitatorUrls } : {}), facilitatorHeaders, ...(facilitatorAuth ? { facilitatorAuth } : {}), resourceOrigin, ...(payTo ? { payTo } : {}), ...(solanaPayTo ? { solanaPayTo } : {}), ...networkSelection, testnetNetworksEnabled, timeoutMs, routes };
}

export function matchX402Route(config: X402Config | undefined, method: string | undefined, path: string) {
  if (!config || method?.toUpperCase() !== 'GET') return undefined;
  return config.routes.find(route => route.regex.test(path));
}

/**
 * Return only the locally selected rails that the current facilitator can
 * settle right now. Discovery uses this so agents never see a configured
 * chain as purchasable merely because it appears in an environment allowlist.
 */
export async function discoverX402AvailableNetworks(config: X402Config, signal?: AbortSignal): Promise<X402NetworkDescriptor[]> {
  const supported = await getSupportedNetworks(config, signal);
  return X402_STAGING_NETWORKS
    .filter(network => config.networks.includes(network.network) && supported.networks.has(network.network))
    .filter(network => network.family === 'evm' ? Boolean(config.payTo) : Boolean(config.solanaPayTo && supported.solanaFeePayer))
    .map(({ family, network, chainId, name, asset, assetName }) => ({ family, network, chainId, name, asset, assetName }));
}

/** Implements the x402 v2 HTTP lifecycle through the configured facilitator. */
export function createX402PaymentService(config: X402Config) {
  return {
    async prepare(route: X402Route, resourceUrl: string, paymentHeader: string | undefined, signal?: AbortSignal): Promise<{ kind: 'required'; response: Record<string, unknown>; header: string } | { kind: 'invalid'; status: 400 | 402; response: Record<string, unknown>; header: string } | { kind: 'authorized'; context: X402PaymentContext }> {
      const supported = await getSupportedNetworks(config, signal);
      const requirements = X402_STAGING_NETWORKS.filter(network => config.networks.includes(network.network)).map(network => makeRequirement(config, route, network, supported.solanaFeePayer))
        .filter((requirement): requirement is X402Requirement => Boolean(requirement && supported.networks.has(requirement.network)));
      if (requirements.length === 0) throw new Error('Configured facilitator does not support exact payments on any locally configured network');
      const resource = {
        url: resourceUrl,
        description: route.description,
        mimeType: 'application/json',
        serviceName: BAZAAR_SERVICE.serviceName,
        tags: BAZAAR_SERVICE.tags,
        iconUrl: new URL(BAZAAR_SERVICE.iconUrl, config.resourceOrigin).toString(),
      };
      let payload: X402PaymentPayload | undefined;
      let malformed = false;
      if (paymentHeader) {
        try { payload = decodePaymentHeader(paymentHeader); } catch { malformed = true; }
      }
      // Bazaar receives a self-validating description of the exact paid HTTP
      // resource. Receipt IDs are path parameters, not service metadata.
      const extensions = { bazaar: bazaarDiscovery(route, resourceUrl) };
      const paymentRequired = (error: string) => ({ x402Version: 2, error, resource, accepts: requirements, extensions });
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
      }, signal, facilitatorFor(config, requirement.network));
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
      let settlementAttempts = 1;
      let settlement = parseSettlementResponse(await facilitatorJson(config, 'settle', request, signal, facilitatorFor(config, context.requirement.network)), context.requirement);
      if (!settlement.success && settlement.errorReason === 'settlement_pending') {
        const pending = settlement;
        settlementAttempts++;
        try { settlement = parseSettlementResponse(await facilitatorJson(config, 'settle', request, signal, facilitatorFor(config, context.requirement.network)), context.requirement); }
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
      return { success: settlement.success, settlement, attempts: settlementAttempts, response: buyerFacing, header: encodeBase64Json(buyerFacing) };
    },
  };
}

function parseSettlementResponse(value: unknown, requirement: X402Requirement) {
  if (!isRecord(value) || typeof value.success !== 'boolean' || typeof value.network !== 'string' || typeof value.transaction !== 'string') {
    throw new Error('Configured facilitator returned an invalid settlement response');
  }
  if (value.network !== requirement.network || value.transaction.length > 128 || value.transaction !== '' && !validSettlementTransaction(value.transaction, requirement.network)) {
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
    payer = requirement.network === SOLANA_MAINNET_CAIP2
      ? parseSolanaPublicKey(value.payer, 'facilitator payer')
      : parseEvmAddress(value.payer, 'facilitator payer');
  }
  let amount: string | undefined;
  if (value.amount !== undefined) {
    if (typeof value.amount !== 'string' || value.amount !== requirement.amount) throw new Error('Configured facilitator returned a mismatched settlement amount');
    amount = value.amount;
  }
  const errorReason = typeof value.errorReason === 'string' ? value.errorReason : undefined;
  return {
    success: value.success,
    transaction: value.transaction,
    network: value.network,
    ...(errorReason ? { errorReason } : {}),
    ...(payer ? { payer } : {}),
    ...(amount ? { amount } : {}),
  };
}

function makeRequirement(config: X402Config, route: X402Route, network: typeof X402_STAGING_NETWORKS[number], solanaFeePayer: string | null): X402Requirement | null {
  if (network.family === 'svm') {
    if (!config.solanaPayTo || !solanaFeePayer) return null;
    return {
      scheme: 'exact', network: network.network, amount: priceToAtomicUnits(route.price), asset: network.asset,
      payTo: config.solanaPayTo, maxTimeoutSeconds: 60, extra: { feePayer: solanaFeePayer },
    };
  }
  if (!config.payTo) return null;
  return {
    scheme: 'exact',
    network: network.network,
    amount: assetAmountForNetwork(network, priceToAtomicUnits(route.price)),
    asset: network.asset,
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: { name: network.assetName, version: network.assetVersion },
  };
}

type X402NetworkEntry = (typeof X402_NETWORKS)[number] | (typeof X402_STAGING_EVM_NETWORKS)[number];

function assetDecimalsFor(network: X402NetworkEntry): number {
  return 'assetDecimals' in network ? network.assetDecimals : 6;
}

/**
 * Convert the canonical 6-decimal micro-USDC route price into the network's
 * settlement-token atomic units. Integer math keeps this lossless on the
 * 18-decimal BNB Smart Chain USDC.
 */
function assetAmountForNetwork(network: X402NetworkEntry, microAmount: string): string {
  const decimals = assetDecimalsFor(network);
  return decimals === 6 ? microAmount : (BigInt(microAmount) * 10n ** BigInt(decimals - 6)).toString();
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

/**
 * x402 v2 Bazaar discovery metadata. The extension schema is deliberately
 * self-contained: facilitators must not fetch external $ref values while
 * validating metadata received from an untrusted payment payload.
 */
function bazaarDiscovery(route: X402Route, resourceUrl: string) {
  const pathParams = bazaarPathParams(route.path, resourceUrl);
  const input = {
    type: 'http',
    method: route.method,
    ...(Object.keys(pathParams).length ? { pathParams } : {}),
  };
  const pathParamNames = Object.keys(pathParams);
  return {
    info: {
      input,
      output: bazaarOutput(route.path),
    },
    schema: bazaarSchema(pathParamNames),
    ...(pathParamNames.length ? { routeTemplate: route.path } : {}),
  };
}

function bazaarPathParams(routePath: string, resourceUrl: string) {
  const template = routePath.replace(/\/+$/, '').split('/');
  const pathname = new URL(resourceUrl).pathname.replace(/\/+$/, '') || '/';
  const actual = pathname.split('/');
  const params: Record<string, string> = {};
  for (let index = 0; index < template.length; index += 1) {
    const segment = template[index];
    if (!segment.startsWith(':')) continue;
    const value = actual[index];
    if (!value || value.length > 512 || /[\u0000-\u001F\u007F]/.test(value)) throw new TypeError('x402 resource URL has an invalid dynamic path parameter');
    params[segment.slice(1)] = decodeURIComponent(value);
  }
  return params;
}

function bazaarSchema(pathParamNames: string[]) {
  const pathParams = pathParamNames.length
    ? {
      type: 'object',
      properties: Object.fromEntries(pathParamNames.map(name => [name, { type: 'string', minLength: 1, maxLength: 512 }])),
      required: pathParamNames,
      additionalProperties: false,
    }
    : undefined;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      input: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'http' },
          method: { type: 'string', enum: ['GET', 'HEAD', 'DELETE'] },
          ...(pathParams ? { pathParams } : {}),
        },
        required: ['type', 'method', ...(pathParams ? ['pathParams'] : [])],
        additionalProperties: false,
      },
      output: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'json' },
          format: { type: 'string' },
          example: {},
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
    required: ['input'],
    additionalProperties: false,
  };
}

function bazaarOutput(path: string) {
  if (path.endsWith('/bundle')) {
    return {
      type: 'json',
      format: 'priorseal.verification-bundle.v1',
      example: {
        schema: 'priorseal.verification-bundle.v1',
        receipt: { receiptId: 'psr_example', executionStatus: 'COMPLETED' },
        keyRegistry: { schema: 'priorseal.keys.v1', keys: [] },
        bundleHash: '0'.repeat(64),
      },
    };
  }
  if (path.endsWith('/check')) {
    return {
      type: 'json',
      format: 'priorseal.fresh-evidence-check.v1',
      example: {
        schema: 'priorseal.fresh-evidence-check.v1',
        checkId: 'psc_example',
        receiptVerification: { valid: true, code: 'OK' },
        current: { status: 'CONFIRMED', finalityState: 'FINALIZED' },
        issuer: 'priorseal.xyz',
        algorithm: 'Ed25519',
      },
    };
  }
  if (path.startsWith('/v1/evidence/receipts/')) return {
    type: 'json',
    format: 'priorseal.evidence.v1',
    example: {
      schema: 'priorseal.evidence.v1',
      evidenceId: 'pse_example',
      subject: { receiptId: 'psr_example' },
      verification: { method: 'verification_bundle', required: 'VERIFY_LOCALLY_WITH_INDEPENDENT_ISSUER_KEY_TRUST' },
    },
  };
  return {
    type: 'json',
    format: 'application/json',
    example: { status: 'paid_resource_delivered' },
  };
}

function parseFacilitatorUrl(value: string, name = 'PRIORSEAL_X402_FACILITATOR_URL') {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError(`${name} must be a valid URL`); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new TypeError(`${name} must be HTTPS (HTTP is allowed only for localhost) and must not contain credentials, query, or fragment`);
  return url.toString().replace(/\/+$/, '');
}

/**
 * Parse per-network facilitator overrides (e.g. routing eip155:56 to a
 * facilitator that serves its settlement token). Entries are "network=url"
 * pairs separated by commas; every network must be a known rail and every URL
 * passes the same validation as the default facilitator.
 */
function parseFacilitatorUrls(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const entries = value.split(',').map(entry => entry.trim()).filter(Boolean);
  if (!entries.length) throw new TypeError('PRIORSEAL_X402_FACILITATOR_URLS entries must be "network=url" pairs separated by commas');
  const known: Set<string> = new Set(X402_STAGING_NETWORKS.map(network => network.network));
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    const network = separator === -1 ? '' : entry.slice(0, separator).trim();
    const url = separator === -1 ? '' : entry.slice(separator + 1).trim();
    if (!network || !url) throw new TypeError('PRIORSEAL_X402_FACILITATOR_URLS entries must be "network=url" pairs separated by commas');
    if (!known.has(network)) throw new TypeError(`PRIORSEAL_X402_FACILITATOR_URLS contains an unsupported payment network: ${network}`);
    if (result[network]) throw new TypeError(`PRIORSEAL_X402_FACILITATOR_URLS has a duplicate entry for ${network}`);
    result[network] = parseFacilitatorUrl(url, 'PRIORSEAL_X402_FACILITATOR_URLS');
  }
  return result;
}

/** Resolve the facilitator serving one network's exact payments. */
function facilitatorFor(config: X402Config, network: string) {
  return config.facilitatorUrls?.[network] ?? config.facilitatorUrl;
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

function parseSolanaPublicKey(value: string, name: string) {
  if (!isSolanaPublicKey(value)) throw new TypeError(`${name} must be a valid 32-byte Solana public key`);
  return value;
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

function parseFacilitatorAuth(mode: string | undefined, cdpApiKeyId: string | undefined, cdpApiKeySecret: string | undefined, facilitatorUrl: string, staticHeadersConfigured: boolean) {
  if (!mode) {
    if (cdpApiKeyId || cdpApiKeySecret) throw new TypeError('CDP facilitator credentials require PRIORSEAL_X402_FACILITATOR_AUTH_MODE=cdp');
    return undefined;
  }
  if (mode !== 'cdp') throw new TypeError('PRIORSEAL_X402_FACILITATOR_AUTH_MODE must be cdp when configured');
  if (facilitatorUrl !== CDP_X402_FACILITATOR_URL) throw new TypeError(`PRIORSEAL_X402_FACILITATOR_AUTH_MODE=cdp requires ${CDP_X402_FACILITATOR_URL}`);
  return parseCdpFacilitatorAuth({ apiKeyId: cdpApiKeyId, apiKeySecret: cdpApiKeySecret, facilitatorUrl, hasStaticHeaders: staticHeadersConfigured });
}

function parseTimeout(value: string | undefined) {
  if (!value) return 15_000;
  if (!/^\d+$/.test(value)) throw new TypeError('PRIORSEAL_X402_TIMEOUT_MS must be a positive integer');
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > MAX_TIMEOUT_MS) throw new TypeError(`PRIORSEAL_X402_TIMEOUT_MS must be between 1000 and ${MAX_TIMEOUT_MS}`);
  return timeout;
}

function parseNetworkSelection(value: string | undefined, allowTestnets: boolean) {
  if (!value) return { networks: X402_NETWORKS.map(network => network.network), networksExplicitlyConfigured: false };
  const networks = value.split(',').map(network => network.trim());
  const supportedNetworks = allowTestnets ? X402_STAGING_NETWORKS : X402_NETWORKS;
  if (!networks.length || networks.some(network => !network) || networks.length > supportedNetworks.length || new Set(networks).size !== networks.length) throw new TypeError('PRIORSEAL_X402_NETWORKS must be a comma-separated list of unique supported CAIP-2 networks');
  const supported = new Set<string>(supportedNetworks.map(network => network.network));
  if (networks.some(network => !supported.has(network))) throw new TypeError('PRIORSEAL_X402_NETWORKS contains an unsupported payment network');
  return { networks, networksExplicitlyConfigured: true };
}

function parseTestnetNetworkFlag(value: string | undefined, runtimeEnvironment: string | undefined) {
  if (!value) return false;
  if (value !== 'true' && value !== 'false') throw new TypeError('PRIORSEAL_X402_ENABLE_TESTNETS must be true or false');
  if (value === 'false') return false;
  const environment = runtimeEnvironment?.trim() || 'development';
  if (!['staging', 'test', 'development'].includes(environment)) throw new TypeError('PRIORSEAL_X402_ENABLE_TESTNETS is allowed only in staging, test, or development');
  return true;
}

async function getSupportedNetworks(config: X402Config, parentSignal?: AbortSignal) {
  const urls = [...new Set(config.networks.map(network => facilitatorFor(config, network)))];
  const cacheKey = JSON.stringify([urls, config.facilitatorHeaders.supported ?? {}, config.facilitatorAuth?.provider ?? '', config.facilitatorAuth?.apiKeyId ?? '']);
  const cached = capabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = Promise.all(urls.map(async url => parseSupported(await facilitatorJson(config, 'supported', undefined, parentSignal, url)))).then((responses): FacilitatorSupport => {
    const networks = new Set<string>();
    for (const response of responses) for (const network of response.networks) networks.add(network);
    const solanaUrl = facilitatorFor(config, SOLANA_MAINNET_CAIP2);
    const solanaResponse = urls.includes(solanaUrl) ? responses[urls.indexOf(solanaUrl)] : undefined;
    const solanaFeePayer = solanaResponse?.solanaFeePayers.get(SOLANA_MAINNET_CAIP2) ?? null;
    return { networks, solanaFeePayer };
  });
  capabilityCache.set(cacheKey, { expiresAt: Date.now() + 60_000, promise });
  try { return await promise; } catch (error) { capabilityCache.delete(cacheKey); throw error; }
}

function parseSupported(value: unknown): ParsedFacilitatorSupport {
  if (!isRecord(value) || !Array.isArray(value.kinds)) throw new Error('Configured facilitator returned an invalid supported response');
  const kinds = value.kinds as FacilitatorCapability['kinds'];
  for (const kind of kinds) if (!isRecord(kind) || typeof kind.x402Version !== 'number' || typeof kind.scheme !== 'string' || typeof kind.network !== 'string') throw new Error('Configured facilitator returned an invalid supported response');
  const signerFallback = solanaFeePayerFromSupported(value);
  const solanaFeePayers = new Map<string, string>();
  for (const kind of kinds) {
    if (kind.x402Version !== 2 || kind.scheme !== 'exact' || kind.network !== SOLANA_MAINNET_CAIP2) continue;
    const fromKind = solanaFeePayerFromKind(kind);
    if (fromKind) solanaFeePayers.set(kind.network, fromKind);
    else if (signerFallback) solanaFeePayers.set(kind.network, signerFallback);
  }
  return {
    networks: new Set(kinds.filter((kind) => kind.x402Version === 2 && kind.scheme === 'exact').map(kind => kind.network)),
    solanaFeePayers,
  };
}

/**
 * SVM exact payment requirements must name the sponsor's fee payer. The v2
 * capability response may put it on the exact network kind. That per-network
 * metadata takes precedence because a wildcard signer list can include fee
 * payers for multiple Solana clusters. Older facilitators may provide only an
 * unambiguous `signers` entry; fail closed when neither representation is
 * usable rather than inventing an address or advertising an unusable quote.
 */
function solanaFeePayerFromKind(kind: FacilitatorKind): string | null {
  if (kind.extra === undefined) return null;
  if (!isRecord(kind.extra)) throw new Error('Configured facilitator returned invalid Solana fee payer metadata');
  if (kind.extra.feePayer === undefined) return null;
  if (typeof kind.extra.feePayer !== 'string') throw new Error('Configured facilitator returned invalid Solana fee payer metadata');
  return parseSolanaPublicKey(kind.extra.feePayer, 'configured facilitator Solana fee payer');
}

function solanaFeePayerFromSupported(value: Record<string, unknown>): string | null {
  if (value.signers === undefined) return null;
  if (!isRecord(value.signers)) throw new Error('Configured facilitator returned invalid signer metadata');
  const relevant = [value.signers[SOLANA_MAINNET_CAIP2], value.signers['solana:*']];
  const candidates: string[] = [];
  for (const group of relevant) {
    if (group === undefined) continue;
    if (!Array.isArray(group) || !group.every(isSolanaPublicKey)) throw new Error('Configured facilitator returned invalid Solana signer metadata');
    candidates.push(...group);
  }
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

async function facilitatorJson(config: X402Config, operation: 'supported' | 'verify' | 'settle', body: unknown, parentSignal?: AbortSignal, urlOverride?: string): Promise<unknown> {
  const url = urlOverride ?? config.facilitatorUrl;
  const target = operation === 'supported' ? `${url}/supported` : `${url}/${operation}`;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) throw parentSignal.reason;
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Facilitator request timed out')), config.timeoutMs);
  try {
    // CDP bearer JWTs are bound to the CDP base URL; never attach them to an
    // overridden facilitator endpoint.
    const authHeaders = url === config.facilitatorUrl && config.facilitatorAuth ? await cdpFacilitatorAuthHeaders(config.facilitatorAuth, operation) : {};
    const response = await fetch(target, {
      method: operation === 'supported' ? 'GET' : 'POST',
      // Cloudflare Workers does not implement redirect: 'error'. Manual mode
      // preserves the same fail-closed rule across both supported runtimes.
      redirect: 'manual',
      headers: { 'content-type': 'application/json', ...authHeaders, ...config.facilitatorHeaders[operation] },
      ...(operation === 'supported' ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const text = await readLimitedText(response, MAX_FACILITATOR_RESPONSE_BYTES);
    if (response.status >= 300 && response.status < 400) throw new Error(`Configured facilitator ${operation} attempted an unexpected redirect`);
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
  if (accepted.scheme !== 'exact' || typeof accepted.network !== 'string' || typeof accepted.amount !== 'string' || typeof accepted.asset !== 'string' || typeof accepted.payTo !== 'string' || !Number.isSafeInteger(accepted.maxTimeoutSeconds) || !isStringRecord(accepted.extra)) throw new TypeError('Invalid PAYMENT-SIGNATURE accepted requirements');
  return parsed as unknown as X402PaymentPayload;
}

function matchesRequirement(accepted: X402Requirement, requirement: X402Requirement) {
  const svm = requirement.network === SOLANA_MAINNET_CAIP2;
  return accepted.scheme === requirement.scheme
    && accepted.network === requirement.network
    && accepted.amount === requirement.amount
    && (svm ? accepted.asset === requirement.asset : accepted.asset.toLowerCase() === requirement.asset.toLowerCase())
    && (svm ? accepted.payTo === requirement.payTo : accepted.payTo.toLowerCase() === requirement.payTo.toLowerCase())
    && accepted.maxTimeoutSeconds === requirement.maxTimeoutSeconds
    && sameStringRecord(accepted.extra, requirement.extra);
}

function validSettlementTransaction(value: string, network: string) {
  if (network !== SOLANA_MAINNET_CAIP2) return /^0x[0-9a-fA-F]{64}$/.test(value);
  try { return decodeBase58(value).length === 64; } catch { return false; }
}

function encodeBase64Json(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function optional(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isStringRecord(value: unknown): value is Record<string, string> { return isRecord(value) && Object.values(value).every(item => typeof item === 'string'); }
function sameStringRecord(left: Record<string, string>, right: Record<string, string>) {
  const leftKeys = Object.keys(left).sort(); const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
