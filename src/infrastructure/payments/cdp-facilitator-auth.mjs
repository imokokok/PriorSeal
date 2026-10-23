// Generated from cdp-facilitator-auth.mts by npm run core:build. Do not edit directly.
const CDP_X402_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const CDP_X402_DISCOVERY_SEARCH_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
function parseCdpFacilitatorAuth({ apiKeyId, apiKeySecret, facilitatorUrl, hasStaticHeaders }) {
  if (facilitatorUrl !== CDP_X402_FACILITATOR_URL) throw new TypeError(`PRIORSEAL_X402_FACILITATOR_AUTH_MODE=cdp requires ${CDP_X402_FACILITATOR_URL}`);
  if (hasStaticHeaders) throw new TypeError("PRIORSEAL_X402_FACILITATOR_HEADERS_JSON cannot be combined with CDP facilitator authentication");
  if (!apiKeyId || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(apiKeyId)) throw new TypeError("PRIORSEAL_X402_CDP_API_KEY_ID must be a valid CDP API key identifier");
  if (!apiKeySecret) throw new TypeError("PRIORSEAL_X402_CDP_API_KEY_SECRET is required when CDP facilitator authentication is selected");
  const key = decodeBase64(apiKeySecret, "PRIORSEAL_X402_CDP_API_KEY_SECRET");
  if (key.byteLength !== 64) throw new TypeError("PRIORSEAL_X402_CDP_API_KEY_SECRET must contain a 64-byte Ed25519 key");
  return { provider: "cdp", apiKeyId, apiKeySecret };
}
async function cdpFacilitatorAuthHeaders(auth, operation) {
  const endpoint = new URL(`${CDP_X402_FACILITATOR_URL}/${operation}`);
  return cdpApiAuthHeaders(auth, operation === "supported" ? "GET" : "POST", endpoint);
}
async function cdpApiAuthHeaders(auth, method, endpoint) {
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.host !== "api.cdp.coinbase.com" || !endpoint.pathname.startsWith("/platform/v2/x402/")) {
    throw new TypeError("CDP API authentication is limited to HTTPS x402 API endpoints");
  }
  const jwt = await cdpJwt(auth, method, endpoint);
  return { Authorization: `Bearer ${jwt}` };
}
async function cdpJwt(auth, method, endpoint) {
  try {
    const keyBytes = decodeBase64(auth.apiKeySecret, "PRIORSEAL_X402_CDP_API_KEY_SECRET");
    const key = await crypto.subtle.importKey("jwk", {
      kty: "OKP",
      crv: "Ed25519",
      d: base64Url(keyBytes.slice(0, 32)),
      x: base64Url(keyBytes.slice(32))
    }, "Ed25519", false, ["sign"]);
    const now = Math.floor(Date.now() / 1e3);
    const protectedHeader = base64Url(JSON.stringify({ alg: "EdDSA", kid: auth.apiKeyId, typ: "JWT", nonce: randomHex(16) }));
    const payload = base64Url(JSON.stringify({ sub: auth.apiKeyId, iss: "cdp", iat: now, nbf: now, exp: now + 120, uris: [`${method} ${endpoint.host}${endpoint.pathname}`] }));
    const input = `${protectedHeader}.${payload}`;
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(input)));
    return `${input}.${base64Url(signature)}`;
  } catch {
    throw new Error("CDP facilitator authentication could not be created");
  }
}
function decodeBase64(value, name) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError(`${name} must be base64`);
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function randomHex(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
export {
  CDP_X402_DISCOVERY_SEARCH_URL,
  CDP_X402_FACILITATOR_URL,
  cdpApiAuthHeaders,
  cdpFacilitatorAuthHeaders,
  parseCdpFacilitatorAuth
};
