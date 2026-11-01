import {
  HYPERCORE_USD_SEND_METHOD,
  HYPERCORE_X402_MAINNET,
  HypercorePaymentError,
  isHypercoreNetwork,
  validateHypercoreExchangeUrl,
  type HypercoreX402Network,
} from '../infrastructure/payments/hypercore-x402-protocol.mjs';
import {
  HypercorePaymentCoordinator,
  type HypercorePaymentStore,
} from './coordinator.mjs';

type HypercoreFacilitatorEnv = {
  HYPERCORE_X402_PAYMENTS: DurableObjectNamespace;
  DB: D1Database;
  HYPERCORE_X402_ENABLED?: string;
  HYPERCORE_X402_NETWORK?: string;
  HYPERCORE_X402_PAY_TO?: string;
  HYPERCORE_X402_EXCHANGE_URL?: string;
  HYPERCORE_X402_MAX_TIMEOUT_SECONDS?: string;
  /** Secret JSON map: `{ "insight": "…", "priorseal": "…" }`. */
  HYPERCORE_X402_MERCHANTS_JSON?: string;
};

type FacilitatorConfig = {
  enabled: boolean;
  network: HypercoreX402Network;
  payTo: string;
  exchangeUrl: string;
  maxTimeoutSeconds: number;
  merchants: Readonly<Record<string, string>>;
};

const MAX_BODY_BYTES = 64 * 1024;
const MERCHANT_CLOCK_SKEW_MS = 60_000;
const INTERNAL_ORIGIN = 'https://hypercore-facilitator.internal';

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

function parseConfig(env: HypercoreFacilitatorEnv): FacilitatorConfig {
  const enabled = env.HYPERCORE_X402_ENABLED === 'true';
  const networkRaw = env.HYPERCORE_X402_NETWORK ?? HYPERCORE_X402_MAINNET;
  if (!isHypercoreNetwork(networkRaw)) throw new HypercorePaymentError('invalid_config', 'HYPERCORE_X402_NETWORK is invalid');
  const maxRaw = env.HYPERCORE_X402_MAX_TIMEOUT_SECONDS ?? '60';
  if (!/^[1-9][0-9]{0,2}$/.test(maxRaw)) throw new HypercorePaymentError('invalid_config', 'HYPERCORE_X402_MAX_TIMEOUT_SECONDS is invalid');
  const maxTimeoutSeconds = Number(maxRaw);
  if (maxTimeoutSeconds > 60) throw new HypercorePaymentError('invalid_config', 'HYPERCORE_X402_MAX_TIMEOUT_SECONDS must be at most 60');
  const payTo = env.HYPERCORE_X402_PAY_TO?.trim() ?? '';
  const exchangeUrl = validateHypercoreExchangeUrl(
    env.HYPERCORE_X402_EXCHANGE_URL ?? 'https://api.hyperliquid.xyz/exchange',
  );
  let merchants: Record<string, string> = {};
  const merchantsRaw = env.HYPERCORE_X402_MERCHANTS_JSON?.trim() ?? '';
  if (merchantsRaw !== '') {
    try {
      const parsed: unknown = JSON.parse(merchantsRaw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      merchants = Object.fromEntries(Object.entries(parsed).map(([merchantId, secret]) => {
        if (!/^[a-z][a-z0-9_-]{1,63}$/.test(merchantId) || typeof secret !== 'string' || secret.length < 24 || secret.length > 512 || /\s/.test(secret)) {
          throw new Error('invalid merchant entry');
        }
        return [merchantId, secret];
      }));
    } catch {
      throw new HypercorePaymentError('invalid_config', 'HYPERCORE_X402_MERCHANTS_JSON is invalid');
    }
  }
  if (enabled && (payTo === '' || Object.keys(merchants).length === 0)) {
    throw new HypercorePaymentError('invalid_config', 'enabled facilitator requires a payee and at least one merchant secret');
  }
  return { enabled, network: networkRaw, payTo, exchangeUrl, maxTimeoutSeconds, merchants };
}

async function readBody(request: Request): Promise<{ raw: string; value: unknown }> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new HypercorePaymentError('request_too_large', 'request body is too large');
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new HypercorePaymentError('request_too_large', 'request body is too large');
  }
  try { return { raw, value: JSON.parse(raw) as unknown }; }
  catch { throw new HypercorePaymentError('invalid_json', 'request body must be JSON'); }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function authenticateMerchant(request: Request, rawBody: string, config: FacilitatorConfig): Promise<string> {
  const merchantId = request.headers.get('x-hypercore-merchant-id') ?? '';
  const timestamp = request.headers.get('x-hypercore-merchant-timestamp') ?? '';
  const signature = request.headers.get('x-hypercore-merchant-signature') ?? '';
  const secret = config.merchants[merchantId];
  if (!secret || !/^[0-9]{13}$/.test(timestamp) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    throw new HypercorePaymentError('merchant_unauthorized', 'merchant authentication failed');
  }
  if (Math.abs(Date.now() - Number(timestamp)) > MERCHANT_CLOCK_SKEW_MS) {
    throw new HypercorePaymentError('merchant_unauthorized', 'merchant authentication timestamp is stale');
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  if (!timingSafeEqual(base64Url(new Uint8Array(digest)), signature)) {
    throw new HypercorePaymentError('merchant_unauthorized', 'merchant authentication failed');
  }
  return merchantId;
}

function randomQuoteId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

class DurableStore implements HypercorePaymentStore {
  private transactionStorage: DurableObjectTransaction | null = null;

  constructor(private readonly storage: DurableObjectStorage) {}

  get<T>(key: string): Promise<T | undefined> {
    return (this.transactionStorage ?? this.storage).get<T>(key);
  }

  put<T>(key: string, value: T): Promise<void> {
    return (this.transactionStorage ?? this.storage).put(key, value);
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    if (this.transactionStorage) return callback();
    return this.storage.transaction(async (transaction) => {
      this.transactionStorage = transaction;
      try { return await callback(); }
      finally { this.transactionStorage = null; }
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Single global coordinator. At the deliberately limited beta throughput this
 * is the simplest way to atomically consume both a quote and a payer/time key.
 * Sharding is an explicit future migration, not a silent relaxation of replay
 * protection.
 */
export class HypercorePaymentGate implements DurableObject {
  private readonly store: DurableStore;

  constructor(private readonly state: DurableObjectState, private readonly env: HypercoreFacilitatorEnv) {
    this.store = new DurableStore(state.storage);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    try {
      const input: unknown = await request.json();
      if (!isRecord(input) || typeof input.operation !== 'string') throw new HypercorePaymentError('invalid_request', 'internal request is invalid');
      const config = parseConfig(this.env);
      const coordinator = new HypercorePaymentCoordinator(this.store, {
        submit: async (exchangeRequest) => {
          const response = await fetch(config.exchangeUrl, {
            method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(exchangeRequest), signal: AbortSignal.timeout(10_000),
          });
          const raw = await response.text();
          if (raw.length > 16 * 1024) throw new HypercorePaymentError('exchange_response_too_large', 'exchange response is too large');
          let payload: unknown;
          try { payload = JSON.parse(raw) as unknown; } catch { throw new HypercorePaymentError('exchange_invalid_response', 'exchange did not return JSON'); }
          if (!response.ok) throw new HypercorePaymentError('exchange_rejected', 'exchange rejected the action');
          return payload;
        },
      });
      if (input.operation === 'quote') {
        if (typeof input.merchantId !== 'string' || typeof input.resource !== 'string' || input.resource.length < 1 || input.resource.length > 2_048 || input.amount === undefined) {
          throw new HypercorePaymentError('invalid_quote', 'quote request is invalid');
        }
        const quote = await coordinator.createQuote({
          quoteId: randomQuoteId(), merchantId: input.merchantId, resource: input.resource,
          network: config.network, amount: typeof input.amount === 'string' ? input.amount : '',
          payTo: config.payTo, maxTimeoutSeconds: config.maxTimeoutSeconds,
        });
        await this.audit('quote_created', quote);
        return json({ requirement: quote.requirement, expiresAt: quote.expiresAt });
      }
      if (input.operation === 'verify') {
        if (typeof input.merchantId !== 'string') throw new HypercorePaymentError('invalid_request', 'merchantId is required');
        const verified = await coordinator.verify(input.paymentPayload, input.merchantId);
        return json(verified);
      }
      if (input.operation === 'settle') {
        if (typeof input.merchantId !== 'string') throw new HypercorePaymentError('invalid_request', 'merchantId is required');
        const settlement = await coordinator.settle(input.paymentPayload, input.merchantId);
        if (settlement.transaction) {
          const payment = await coordinator.quote(isRecord(input.paymentPayload) && isRecord(input.paymentPayload.payload) && typeof input.paymentPayload.payload.quoteId === 'string' ? input.paymentPayload.payload.quoteId : '');
          if (payment) await this.audit(`settlement_${payment.state.toLowerCase()}`, payment);
        }
        return json(settlement);
      }
      throw new HypercorePaymentError('invalid_request', 'unknown internal operation');
    } catch (error) {
      const typed = error instanceof HypercorePaymentError ? error : new HypercorePaymentError('internal_error', 'facilitator failed');
      return json({ error: typed.code }, typed.code === 'invalid_request' ? 400 : 422);
    }
  }

  private async audit(event: string, quote: { quoteId: string; merchantId: string; resource: string; requirement: { network: string; amount: string; payTo: string }; state: string; payer?: string; paymentId?: string; createdAt: number; settledAt?: number }) {
    try {
      await this.env.DB.prepare(
        'INSERT OR REPLACE INTO hypercore_x402_payments (quote_id, merchant_id, resource, network, amount, pay_to, payer, payment_id, state, event, created_at, settled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(quote.quoteId, quote.merchantId, quote.resource, quote.requirement.network, quote.requirement.amount, quote.requirement.payTo, quote.payer ?? null, quote.paymentId ?? null, quote.state, event, quote.createdAt, quote.settledAt ?? null).run();
    } catch (error) {
      // Audit persistence is intentionally never in the money path. The DO
      // state remains the settlement authority and failed audit writes are
      // observable in Worker logs without exposing payment data to callers.
      console.error(JSON.stringify({ event: 'hypercore_x402.audit_failed', message: error instanceof Error ? error.message : 'unknown' }));
    }
  }
}

async function forwardToGate(env: HypercoreFacilitatorEnv, body: Record<string, unknown>): Promise<Response> {
  const gate = env.HYPERCORE_X402_PAYMENTS.getByName('hypercore-x402-v1-global');
  return gate.fetch(new Request(`${INTERNAL_ORIGIN}/payment`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

export default {
  async fetch(request: Request, env: HypercoreFacilitatorEnv): Promise<Response> {
    try {
      const config = parseConfig(env);
      const path = new URL(request.url).pathname;
      if (path === '/supported' && request.method === 'GET') {
        return json({
          kinds: config.enabled ? [{ x402Version: 2, scheme: 'exact', network: config.network, extra: { assetTransferMethod: HYPERCORE_USD_SEND_METHOD, protocolVersion: '1' } }] : [],
          extensions: [], signers: {},
        });
      }
      if (!config.enabled) return json({ error: 'facilitator_disabled' }, 503);
      if (!['/v1/quotes', '/verify', '/settle'].includes(path) || request.method !== 'POST') return json({ error: 'not_found' }, 404);
      const { raw, value } = await readBody(request);
      const merchantId = await authenticateMerchant(request, raw, config);
      if (!isRecord(value)) throw new HypercorePaymentError('invalid_request', 'request body must be an object');
      if (path === '/v1/quotes') {
        return forwardToGate(env, { operation: 'quote', merchantId, resource: value.resource, amount: value.amount });
      }
      if (!isRecord(value.paymentPayload)) throw new HypercorePaymentError('invalid_request', 'paymentPayload is required');
      return forwardToGate(env, { operation: path === '/verify' ? 'verify' : 'settle', merchantId, paymentPayload: value.paymentPayload });
    } catch (error) {
      const typed = error instanceof HypercorePaymentError ? error : new HypercorePaymentError('internal_error', 'facilitator failed');
      const status = typed.code === 'merchant_unauthorized' ? 401 : typed.code === 'invalid_json' || typed.code === 'request_too_large' || typed.code === 'invalid_request' ? 400 : typed.code === 'invalid_config' ? 503 : 422;
      return json({ error: typed.code }, status);
    }
  },
} satisfies ExportedHandler<HypercoreFacilitatorEnv>;
