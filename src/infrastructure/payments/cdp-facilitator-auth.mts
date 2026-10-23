/**
 * CDP's hosted facilitator authenticates every x402 endpoint separately with
 * an API-key JWT bound to the exact HTTP method, host, and path. Keep this
 * small adapter dependency-free so it runs in both Node 22 and Workers' Web
 * Crypto runtime without carrying a wallet key or a long-lived bearer token.
 */
export const CDP_X402_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';
export const CDP_X402_DISCOVERY_SEARCH_URL = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/search';

export type CdpFacilitatorAuth = { provider: 'cdp'; apiKeyId: string; apiKeySecret: string };
export type CdpFacilitatorOperation = 'supported' | 'verify' | 'settle';

export function parseCdpFacilitatorAuth({ apiKeyId, apiKeySecret, facilitatorUrl, hasStaticHeaders }: { apiKeyId: string | undefined; apiKeySecret: string | undefined; facilitatorUrl: string; hasStaticHeaders: boolean }): CdpFacilitatorAuth {
  if (facilitatorUrl !== CDP_X402_FACILITATOR_URL) throw new TypeError(`PRIORSEAL_X402_FACILITATOR_AUTH_MODE=cdp requires ${CDP_X402_FACILITATOR_URL}`);
  if (hasStaticHeaders) throw new TypeError('PRIORSEAL_X402_FACILITATOR_HEADERS_JSON cannot be combined with CDP facilitator authentication');
  if (!apiKeyId || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(apiKeyId)) throw new TypeError('PRIORSEAL_X402_CDP_API_KEY_ID must be a valid CDP API key identifier');
  if (!apiKeySecret) throw new TypeError('PRIORSEAL_X402_CDP_API_KEY_SECRET is required when CDP facilitator authentication is selected');
  const key = decodeBase64(apiKeySecret, 'PRIORSEAL_X402_CDP_API_KEY_SECRET');
  if (key.byteLength !== 64) throw new TypeError('PRIORSEAL_X402_CDP_API_KEY_SECRET must contain a 64-byte Ed25519 key');
  return { provider: 'cdp', apiKeyId, apiKeySecret };
}

/** Build a fresh, endpoint-bound CDP bearer header. Tokens expire in 120 seconds. */
export async function cdpFacilitatorAuthHeaders(auth: CdpFacilitatorAuth, operation: CdpFacilitatorOperation): Promise<Record<string, string>> {
  const endpoint = new URL(`${CDP_X402_FACILITATOR_URL}/${operation}`);
  return cdpApiAuthHeaders(auth, operation === 'supported' ? 'GET' : 'POST', endpoint);
}

/**
 * Creates an API-key JWT for a CDP x402 API endpoint.
 *
 * The endpoint validation prevents an operational checker from accidentally
 * signing a request for a different host or CDP product surface. Query
 * parameters are deliberately excluded from the JWT URI claim, as CDP binds
 * that claim to the HTTP method, host, and path.
 */
export async function cdpApiAuthHeaders(auth: CdpFacilitatorAuth, method: 'GET' | 'POST', endpoint: URL): Promise<Record<string, string>> {
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.host !== 'api.cdp.coinbase.com' || !endpoint.pathname.startsWith('/platform/v2/x402/')) {
    throw new TypeError('CDP API authentication is limited to HTTPS x402 API endpoints');
  }
  const jwt = await cdpJwt(auth, method, endpoint);
  return { Authorization: `Bearer ${jwt}` };
}

async function cdpJwt(auth: CdpFacilitatorAuth, method: 'GET' | 'POST', endpoint: URL): Promise<string> {
  try {
    const keyBytes = decodeBase64(auth.apiKeySecret, 'PRIORSEAL_X402_CDP_API_KEY_SECRET');
    const key = await crypto.subtle.importKey('jwk', {
      kty: 'OKP',
      crv: 'Ed25519',
      d: base64Url(keyBytes.slice(0, 32)),
      x: base64Url(keyBytes.slice(32)),
    }, 'Ed25519', false, ['sign']);
    const now = Math.floor(Date.now() / 1_000);
    const protectedHeader = base64Url(JSON.stringify({ alg: 'EdDSA', kid: auth.apiKeyId, typ: 'JWT', nonce: randomHex(16) }));
    const payload = base64Url(JSON.stringify({ sub: auth.apiKeyId, iss: 'cdp', iat: now, nbf: now, exp: now + 120, uris: [`${method} ${endpoint.host}${endpoint.pathname}`] }));
    const input = `${protectedHeader}.${payload}`;
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(input)));
    return `${input}.${base64Url(signature)}`;
  } catch {
    // Do not expose credential formatting or crypto details through a payment route.
    throw new Error('CDP facilitator authentication could not be created');
  }
}

function decodeBase64(value: string, name: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError(`${name} must be base64`);
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomHex(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
