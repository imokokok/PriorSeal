import {
  HypercorePaymentError,
  parseHypercorePaymentPayload,
  parseHypercorePaymentRequirement,
  type HypercorePaymentRequirement,
  type HypercoreX402Network,
} from './hypercore-x402-protocol.mjs';

const MAX_RESPONSE_BYTES = 64 * 1024;

/** Minimal transport boundary shared by global fetch and a Workers service binding. */
export type HypercoreFacilitatorFetcher = Pick<Fetcher, 'fetch'>;

export type HypercoreFacilitatorMerchantConfig = {
  url: string;
  merchantId: string;
  merchantSecret: string;
  network: HypercoreX402Network;
  payTo: string;
  timeoutMs: number;
  /** Optional private in-platform transport; public HTTPS remains the default. */
  fetcher?: HypercoreFacilitatorFetcher;
};

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new HypercorePaymentError('facilitator_response_too_large', 'HyperCore facilitator response is too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new HypercorePaymentError('facilitator_invalid_response', 'HyperCore facilitator returned no body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new HypercorePaymentError('facilitator_response_too_large', 'HyperCore facilitator response is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new HypercorePaymentError('facilitator_invalid_response', 'HyperCore facilitator returned invalid JSON'); }
}

export function parseHypercoreFacilitatorConfig(input: {
  url: string;
  merchantId: string;
  merchantSecret: string;
  network: HypercoreX402Network;
  payTo: string;
  timeoutMs: number;
  fetcher?: HypercoreFacilitatorFetcher;
}): HypercoreFacilitatorMerchantConfig {
  let url: URL;
  try { url = new URL(input.url); } catch { throw new HypercorePaymentError('invalid_config', 'HyperCore facilitator URL is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new HypercorePaymentError('invalid_config', 'HyperCore facilitator URL must be HTTPS without credentials, query, or fragment');
  }
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(input.merchantId) || input.merchantSecret.length < 24 || input.merchantSecret.length > 512 || /\s/.test(input.merchantSecret)) {
    throw new HypercorePaymentError('invalid_config', 'HyperCore merchant credentials are invalid');
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000 || input.timeoutMs > 30_000) {
    throw new HypercorePaymentError('invalid_config', 'HyperCore facilitator timeout must be between 1000 and 30000ms');
  }
  return { ...input, url: url.toString().replace(/\/+$/, '') };
}

/** Server-only HMAC client. No browser code receives merchant credentials. */
export function createHypercoreFacilitatorClient(config: HypercoreFacilitatorMerchantConfig) {
  const call = async (path: '/v1/quotes' | '/verify' | '/settle', body: Record<string, unknown>): Promise<unknown> => {
    const raw = JSON.stringify(body);
    const timestamp = String(Date.now());
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.merchantSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('HyperCore facilitator request timed out')), config.timeoutMs);
    try {
      const response = await (config.fetcher ?? globalThis).fetch(`${config.url}${path}`, {
        method: 'POST', redirect: 'manual',
        headers: {
          'content-type': 'application/json', accept: 'application/json',
          'x-hypercore-merchant-id': config.merchantId,
          'x-hypercore-merchant-timestamp': timestamp,
          'x-hypercore-merchant-signature': base64Url(new Uint8Array(digest)),
        },
        body: raw, signal: controller.signal,
      });
      let value: unknown;
      try {
        value = await readJson(response);
      } catch (error) {
        if (error instanceof HypercorePaymentError && error.code === 'facilitator_invalid_response') {
          const contentType = response.headers.get('content-type') ?? 'missing';
          throw new HypercorePaymentError(
            'facilitator_invalid_response',
            `HyperCore facilitator returned invalid JSON (HTTP ${response.status}, content-type ${contentType})`,
          );
        }
        throw error;
      }
      if (!response.ok) {
        const reason = isRecord(value) && typeof value.error === 'string' ? value.error : 'facilitator_request_failed';
        throw new HypercorePaymentError(reason, `HyperCore facilitator ${path} failed`);
      }
      return value;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async quote(resource: string, amount: string): Promise<HypercorePaymentRequirement> {
      const value = await call('/v1/quotes', { resource, amount });
      if (!isRecord(value)) throw new HypercorePaymentError('facilitator_invalid_response', 'HyperCore quote response is invalid');
      const requirement = parseHypercorePaymentRequirement(value.requirement);
      if (requirement.network !== config.network || requirement.payTo.toLowerCase() !== config.payTo.toLowerCase()) {
        throw new HypercorePaymentError('facilitator_mismatch', 'HyperCore facilitator returned an unexpected network or payee');
      }
      return requirement;
    },
    async verify(paymentPayload: unknown): Promise<{ isValid: boolean; payer?: string; invalidReason?: string }> {
      // Parse locally before signing an authenticated relay request. This makes
      // malformed client input cheap and avoids turning the facilitator into a
      // generic JSON oracle.
      parseHypercorePaymentPayload(paymentPayload);
      const value = await call('/verify', { paymentPayload });
      if (!isRecord(value) || typeof value.isValid !== 'boolean') {
        throw new HypercorePaymentError('facilitator_invalid_response', 'HyperCore verification response is invalid');
      }
      return {
        isValid: value.isValid,
        ...(typeof value.payer === 'string' ? { payer: value.payer } : {}),
        ...(typeof value.invalidReason === 'string' ? { invalidReason: value.invalidReason } : {}),
      };
    },
    async settle(paymentPayload: unknown): Promise<{ success: boolean; transaction: string; network: string; errorReason?: string; payer?: string; amount?: string }> {
      parseHypercorePaymentPayload(paymentPayload);
      const value = await call('/settle', { paymentPayload });
      if (!isRecord(value) || typeof value.success !== 'boolean' || typeof value.transaction !== 'string' || typeof value.network !== 'string') {
        throw new HypercorePaymentError('facilitator_invalid_response', 'HyperCore settlement response is invalid');
      }
      return {
        success: value.success, transaction: value.transaction, network: value.network,
        ...(typeof value.errorReason === 'string' ? { errorReason: value.errorReason } : {}),
        ...(typeof value.payer === 'string' ? { payer: value.payer } : {}),
        ...(typeof value.amount === 'string' ? { amount: value.amount } : {}),
      };
    },
  };
}
