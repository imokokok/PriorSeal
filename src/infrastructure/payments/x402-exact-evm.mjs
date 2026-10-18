// Generated from x402-exact-evm.mts by npm run core:build. Do not edit directly.
import { getAddress } from "viem";
import { assertSafeJson } from "../../shared/safe-json.mjs";
import { decodeBase58, isSolanaPublicKey, SOLANA_MAINNET_CAIP2 } from "../../domain/solana.mjs";
import { CDP_X402_FACILITATOR_URL, cdpFacilitatorAuthHeaders, parseCdpFacilitatorAuth } from "./cdp-facilitator-auth.mjs";
const X402_EVM_NETWORKS = Object.freeze([
  { family: "evm", network: "eip155:1", chainId: 1, name: "Ethereum", asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", assetName: "USD Coin", assetVersion: "2" },
  { family: "evm", network: "eip155:8453", chainId: 8453, name: "Base", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", assetName: "USD Coin", assetVersion: "2" },
  { family: "evm", network: "eip155:10", chainId: 10, name: "OP Mainnet", asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", assetName: "USD Coin", assetVersion: "2" },
  { family: "evm", network: "eip155:42161", chainId: 42161, name: "Arbitrum One", asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", assetName: "USD Coin", assetVersion: "2" },
  { family: "evm", network: "eip155:137", chainId: 137, name: "Polygon PoS", asset: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", assetName: "USD Coin", assetVersion: "2" },
  { family: "evm", network: "eip155:43114", chainId: 43114, name: "Avalanche C-Chain", asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", assetName: "USD Coin", assetVersion: "2" },
  { family: "evm", network: "eip155:1329", chainId: 1329, name: "Sei", asset: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", assetName: "USD Coin", assetVersion: "2" },
  { family: "evm", network: "eip155:196", chainId: 196, name: "X Layer", asset: "0xB6CEceAB302E2E4948951eE7843FC24E92933061", assetName: "USD Coin", assetVersion: "2" },
  { family: "evm", network: "eip155:143", chainId: 143, name: "Monad", asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", assetName: "USDC", assetVersion: "2" },
  {
    family: "evm",
    network: "eip155:56",
    chainId: 56,
    name: "BNB Smart Chain",
    /** Binance-bridged USDC (18 decimals) as listed by the AEON facilitator's exact v2 registry (verified 2026-10-17 in Insight production). */
    asset: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    assetName: "USD Coin",
    assetVersion: "2",
    assetDecimals: 18
  }
]);
const X402_SOLANA_NETWORKS = Object.freeze([
  { family: "svm", network: SOLANA_MAINNET_CAIP2, chainId: 0, name: "Solana mainnet-beta", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", assetName: "USDC" }
]);
const X402_STAGING_EVM_NETWORKS = Object.freeze([
  { family: "evm", network: "eip155:84532", chainId: 84532, name: "Base Sepolia", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", assetName: "USDC", assetVersion: "2" }
]);
const X402_NETWORKS = Object.freeze([...X402_EVM_NETWORKS, ...X402_SOLANA_NETWORKS]);
const X402_STAGING_NETWORKS = Object.freeze([...X402_NETWORKS, ...X402_STAGING_EVM_NETWORKS]);
const MAX_FACILITATOR_RESPONSE_BYTES = 64 * 1024;
const PAYMENT_HEADER_LIMIT = 64 * 1024;
const MAX_TIMEOUT_MS = 2147483647;
const RESERVED_FACILITATOR_HEADERS = /* @__PURE__ */ new Set(["content-type", "content-length", "host", "connection", "transfer-encoding", "payment-signature", "payment-required", "payment-response"]);
const capabilityCache = /* @__PURE__ */ new Map();
function parseX402Config(environment) {
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
    routesJson: optional(environment.PRIORSEAL_X402_ROUTES_JSON)
  };
  if (!Object.entries(raw).some(([key, value]) => key !== "enableTestnets" && Boolean(value))) return void 0;
  for (const field of ["facilitatorUrl", "resourceOrigin", "routesJson"]) {
    if (!raw[field]) throw new TypeError(`PRIORSEAL_X402_${field === "routesJson" ? "ROUTES_JSON" : field === "facilitatorUrl" ? "FACILITATOR_URL" : field === "resourceOrigin" ? "RESOURCE_ORIGIN" : "PAY_TO"} is required when x402 is configured`);
  }
  if (!raw.payTo && !raw.solanaPayTo) throw new TypeError("PRIORSEAL_X402_PAY_TO or PRIORSEAL_X402_SOLANA_PAY_TO is required when x402 is configured");
  const facilitatorUrl = parseFacilitatorUrl(raw.facilitatorUrl);
  const facilitatorUrls = parseFacilitatorUrls(raw.facilitatorUrls);
  const resourceOrigin = parseResourceOrigin(raw.resourceOrigin);
  const payTo = raw.payTo ? parseEvmAddress(raw.payTo, "PRIORSEAL_X402_PAY_TO") : void 0;
  const solanaPayTo = raw.solanaPayTo ? parseSolanaPublicKey(raw.solanaPayTo, "PRIORSEAL_X402_SOLANA_PAY_TO") : void 0;
  const testnetNetworksEnabled = parseTestnetNetworkFlag(raw.enableTestnets, environment.PRIORSEAL_ENVIRONMENT);
  const networkSelection = parseNetworkSelection(raw.networks, testnetNetworksEnabled);
  if (networkSelection.networksExplicitlyConfigured && networkSelection.networks.some((network) => network.startsWith("eip155:")) && !payTo) throw new TypeError("PRIORSEAL_X402_NETWORKS selects an EVM payment rail but PRIORSEAL_X402_PAY_TO is not configured");
  if (networkSelection.networksExplicitlyConfigured && networkSelection.networks.includes(SOLANA_MAINNET_CAIP2) && !solanaPayTo) throw new TypeError("PRIORSEAL_X402_NETWORKS selects Solana but PRIORSEAL_X402_SOLANA_PAY_TO is not configured");
  const timeoutMs = parseTimeout(raw.timeoutMs);
  const facilitatorHeaders = parseFacilitatorHeaders(raw.facilitatorHeadersJson);
  const facilitatorAuth = parseFacilitatorAuth(raw.facilitatorAuthMode, raw.cdpApiKeyId, raw.cdpApiKeySecret, facilitatorUrl, Boolean(raw.facilitatorHeadersJson));
  if (facilitatorAuth && facilitatorUrls) throw new TypeError("PRIORSEAL_X402_FACILITATOR_URLS cannot be combined with CDP facilitator authentication");
  const routes = parseRoutes(raw.routesJson);
  return { facilitatorUrl, ...facilitatorUrls ? { facilitatorUrls } : {}, facilitatorHeaders, ...facilitatorAuth ? { facilitatorAuth } : {}, resourceOrigin, ...payTo ? { payTo } : {}, ...solanaPayTo ? { solanaPayTo } : {}, ...networkSelection, testnetNetworksEnabled, timeoutMs, routes };
}
function matchX402Route(config, method, path) {
  if (!config || method?.toUpperCase() !== "GET") return void 0;
  return config.routes.find((route) => route.regex.test(path));
}
function createX402PaymentService(config) {
  return {
    async prepare(route, resourceUrl, paymentHeader, signal) {
      const supported = await getSupportedNetworks(config, signal);
      const requirements = X402_STAGING_NETWORKS.filter((network) => config.networks.includes(network.network)).map((network) => makeRequirement(config, route, network, supported.solanaFeePayer)).filter((requirement2) => Boolean(requirement2 && supported.networks.has(requirement2.network)));
      if (requirements.length === 0) throw new Error("Configured facilitator does not support exact payments on any locally configured network");
      const resource = { url: resourceUrl, description: route.description, mimeType: "application/json", serviceName: "PriorSeal" };
      let payload;
      let malformed = false;
      if (paymentHeader) {
        try {
          payload = decodePaymentHeader(paymentHeader);
        } catch {
          malformed = true;
        }
      }
      const paymentRequired = (error) => ({ x402Version: 2, error, resource, accepts: requirements });
      const response = paymentRequired(malformed ? "Invalid PAYMENT-SIGNATURE header" : "Payment required");
      const header = encodeBase64Json(response);
      if (malformed) return { kind: "invalid", status: 400, response, header };
      if (!payload) return { kind: "required", response, header };
      const requirement = requirements.find((candidate) => matchesRequirement(payload.accepted, candidate));
      if (!requirement) {
        const invalid = paymentRequired("Payment does not match the advertised requirements");
        return { kind: "invalid", status: 400, response: invalid, header: encodeBase64Json(invalid) };
      }
      const verification = await facilitatorJson(config, "verify", {
        x402Version: payload.x402Version,
        paymentPayload: payload,
        paymentRequirements: requirement
      }, signal, facilitatorFor(config, requirement.network));
      if (!isRecord(verification) || typeof verification.isValid !== "boolean") throw new Error("Configured facilitator returned an invalid verification response");
      if (!verification.isValid) {
        const invalid = paymentRequired("Payment verification failed");
        return { kind: "invalid", status: 402, response: invalid, header: encodeBase64Json(invalid) };
      }
      return { kind: "authorized", context: { payload, requirement } };
    },
    async settle(context, signal) {
      const request = {
        x402Version: context.payload.x402Version,
        paymentPayload: context.payload,
        paymentRequirements: context.requirement
      };
      let settlementAttempts = 1;
      let settlement = parseSettlementResponse(await facilitatorJson(config, "settle", request, signal, facilitatorFor(config, context.requirement.network)), context.requirement);
      if (!settlement.success && settlement.errorReason === "settlement_pending") {
        const pending = settlement;
        settlementAttempts++;
        try {
          settlement = parseSettlementResponse(await facilitatorJson(config, "settle", request, signal, facilitatorFor(config, context.requirement.network)), context.requirement);
        } catch {
          settlement = pending;
        }
      }
      const buyerFacing = {
        success: settlement.success,
        transaction: settlement.transaction,
        network: settlement.network,
        ...!settlement.success && settlement.errorReason ? { errorReason: settlement.errorReason } : {},
        ...settlement.payer ? { payer: settlement.payer } : {},
        ...settlement.amount ? { amount: settlement.amount } : {}
      };
      return { success: settlement.success, settlement, attempts: settlementAttempts, response: buyerFacing, header: encodeBase64Json(buyerFacing) };
    }
  };
}
function parseSettlementResponse(value, requirement) {
  if (!isRecord(value) || typeof value.success !== "boolean" || typeof value.network !== "string" || typeof value.transaction !== "string") {
    throw new Error("Configured facilitator returned an invalid settlement response");
  }
  if (value.network !== requirement.network || value.transaction.length > 128 || value.transaction !== "" && !validSettlementTransaction(value.transaction, requirement.network)) {
    throw new Error("Configured facilitator returned a mismatched settlement response");
  }
  if (value.success && !value.transaction) throw new Error("Configured facilitator returned a successful settlement without a transaction");
  if (!value.success && value.errorReason !== void 0 && (typeof value.errorReason !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.errorReason))) {
    throw new Error("Configured facilitator returned an invalid settlement error reason");
  }
  if (!value.success && value.errorReason === "settlement_pending" && !value.transaction) throw new Error("Configured facilitator returned a pending settlement without a transaction");
  let payer;
  if (value.payer !== void 0) {
    if (typeof value.payer !== "string") throw new Error("Configured facilitator returned an invalid payer");
    payer = requirement.network === SOLANA_MAINNET_CAIP2 ? parseSolanaPublicKey(value.payer, "facilitator payer") : parseEvmAddress(value.payer, "facilitator payer");
  }
  let amount;
  if (value.amount !== void 0) {
    if (typeof value.amount !== "string" || value.amount !== requirement.amount) throw new Error("Configured facilitator returned a mismatched settlement amount");
    amount = value.amount;
  }
  const errorReason = typeof value.errorReason === "string" ? value.errorReason : void 0;
  return {
    success: value.success,
    transaction: value.transaction,
    network: value.network,
    ...errorReason ? { errorReason } : {},
    ...payer ? { payer } : {},
    ...amount ? { amount } : {}
  };
}
function makeRequirement(config, route, network, solanaFeePayer) {
  if (network.family === "svm") {
    if (!config.solanaPayTo || !solanaFeePayer) return null;
    return {
      scheme: "exact",
      network: network.network,
      amount: priceToAtomicUnits(route.price),
      asset: network.asset,
      payTo: config.solanaPayTo,
      maxTimeoutSeconds: 60,
      extra: { feePayer: solanaFeePayer }
    };
  }
  if (!config.payTo) return null;
  return {
    scheme: "exact",
    network: network.network,
    amount: assetAmountForNetwork(network, priceToAtomicUnits(route.price)),
    asset: network.asset,
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: { name: network.assetName, version: network.assetVersion }
  };
}
function assetDecimalsFor(network) {
  return "assetDecimals" in network ? network.assetDecimals : 6;
}
function assetAmountForNetwork(network, microAmount) {
  const decimals = assetDecimalsFor(network);
  return decimals === 6 ? microAmount : (BigInt(microAmount) * 10n ** BigInt(decimals - 6)).toString();
}
function parseRoutes(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("PRIORSEAL_X402_ROUTES_JSON must be valid JSON");
  }
  assertSafeJson(parsed);
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 64) throw new TypeError("PRIORSEAL_X402_ROUTES_JSON must be an array with 1 to 64 GET routes");
  const seen = /* @__PURE__ */ new Set();
  return parsed.map((entry, index) => {
    if (!isRecord(entry) || Object.keys(entry).sort().join(",") !== "description,method,path,price") throw new TypeError(`x402 route ${index} must contain exactly method, path, description, and price`);
    if (entry.method !== "GET") throw new TypeError(`x402 route ${index} must use GET so a failed settlement cannot follow a write operation`);
    if (typeof entry.path !== "string" || !entry.path.startsWith("/v1/") || entry.path.includes("?") || entry.path.includes("#") || entry.path.includes("\\") || entry.path.includes("//")) throw new TypeError(`x402 route ${index} must be a clean /v1/ path pattern`);
    const path = entry.path.replace(/\/$/, "");
    const key = `${entry.method} ${path}`;
    if (seen.has(key)) throw new TypeError(`x402 route ${index} duplicates a previous route`);
    seen.add(key);
    if (path.split("/").some((segment) => segment === "." || segment === ".." || segment.startsWith(":") && !/^:[A-Za-z][A-Za-z0-9_]*$/.test(segment))) throw new TypeError(`x402 route ${index} contains an invalid path segment`);
    if (typeof entry.description !== "string" || !entry.description.trim() || entry.description.length > 300) throw new TypeError(`x402 route ${index} must have a description of at most 300 characters`);
    if (typeof entry.price !== "string") throw new TypeError(`x402 route ${index} must have a USD price string`);
    priceToAtomicUnits(entry.price);
    const regex = new RegExp(`^${path.split("/").map((segment) => segment.startsWith(":") ? "[^/]+" : escapeRegex(segment)).join("/")}/?$`);
    return { method: "GET", path, description: entry.description.trim(), price: entry.price, regex };
  });
}
function priceToAtomicUnits(price) {
  const match = /^\$(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(price);
  if (!match) throw new TypeError('x402 route price must be a positive USD amount such as "$0.01" with at most 6 decimal places');
  const atomic = BigInt(match[1]) * 1000000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (atomic <= 0n || atomic > 9000000000000000000n) throw new TypeError("x402 route price is outside the supported range");
  return atomic.toString();
}
function parseFacilitatorUrl(value, name = "PRIORSEAL_X402_FACILITATOR_URL") {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${name} must be a valid URL`);
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new TypeError(`${name} must be HTTPS (HTTP is allowed only for localhost) and must not contain credentials, query, or fragment`);
  return url.toString().replace(/\/+$/, "");
}
function parseFacilitatorUrls(value) {
  if (!value) return void 0;
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) throw new TypeError('PRIORSEAL_X402_FACILITATOR_URLS entries must be "network=url" pairs separated by commas');
  const known = new Set(X402_STAGING_NETWORKS.map((network) => network.network));
  const result = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    const network = separator === -1 ? "" : entry.slice(0, separator).trim();
    const url = separator === -1 ? "" : entry.slice(separator + 1).trim();
    if (!network || !url) throw new TypeError('PRIORSEAL_X402_FACILITATOR_URLS entries must be "network=url" pairs separated by commas');
    if (!known.has(network)) throw new TypeError(`PRIORSEAL_X402_FACILITATOR_URLS contains an unsupported payment network: ${network}`);
    if (result[network]) throw new TypeError(`PRIORSEAL_X402_FACILITATOR_URLS has a duplicate entry for ${network}`);
    result[network] = parseFacilitatorUrl(url, "PRIORSEAL_X402_FACILITATOR_URLS");
  }
  return result;
}
function facilitatorFor(config, network) {
  return config.facilitatorUrls?.[network] ?? config.facilitatorUrl;
}
function parseResourceOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("PRIORSEAL_X402_RESOURCE_ORIGIN must be a valid origin URL");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new TypeError("PRIORSEAL_X402_RESOURCE_ORIGIN must be an HTTPS origin (HTTP is allowed only for localhost)");
  return url.origin;
}
function parseEvmAddress(value, name) {
  try {
    return getAddress(value);
  } catch {
    throw new TypeError(`${name} must be a valid EVM address`);
  }
}
function parseSolanaPublicKey(value, name) {
  if (!isSolanaPublicKey(value)) throw new TypeError(`${name} must be a valid 32-byte Solana public key`);
  return value;
}
function parseFacilitatorHeaders(value) {
  if (!value) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("PRIORSEAL_X402_FACILITATOR_HEADERS_JSON must be valid JSON");
  }
  assertSafeJson(parsed);
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["supported", "verify", "settle"].includes(key))) throw new TypeError("PRIORSEAL_X402_FACILITATOR_HEADERS_JSON must contain supported, verify, and/or settle header maps");
  const result = {};
  for (const operation of ["supported", "verify", "settle"]) {
    const headers = parsed[operation];
    if (headers === void 0) continue;
    if (!isRecord(headers) || Object.keys(headers).length > 16) throw new TypeError(`x402 facilitator ${operation} headers must be a small JSON object`);
    const normalized = {};
    for (const [name, headerValue] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || RESERVED_FACILITATOR_HEADERS.has(lower) || typeof headerValue !== "string" || !headerValue.trim() || /[\r\n]/.test(headerValue)) throw new TypeError(`x402 facilitator ${operation} headers contain an invalid or reserved header`);
      normalized[name] = headerValue;
    }
    result[operation] = normalized;
  }
  return result;
}
function parseFacilitatorAuth(mode, cdpApiKeyId, cdpApiKeySecret, facilitatorUrl, staticHeadersConfigured) {
  if (!mode) {
    if (cdpApiKeyId || cdpApiKeySecret) throw new TypeError("CDP facilitator credentials require PRIORSEAL_X402_FACILITATOR_AUTH_MODE=cdp");
    return void 0;
  }
  if (mode !== "cdp") throw new TypeError("PRIORSEAL_X402_FACILITATOR_AUTH_MODE must be cdp when configured");
  if (facilitatorUrl !== CDP_X402_FACILITATOR_URL) throw new TypeError(`PRIORSEAL_X402_FACILITATOR_AUTH_MODE=cdp requires ${CDP_X402_FACILITATOR_URL}`);
  return parseCdpFacilitatorAuth({ apiKeyId: cdpApiKeyId, apiKeySecret: cdpApiKeySecret, facilitatorUrl, hasStaticHeaders: staticHeadersConfigured });
}
function parseTimeout(value) {
  if (!value) return 15e3;
  if (!/^\d+$/.test(value)) throw new TypeError("PRIORSEAL_X402_TIMEOUT_MS must be a positive integer");
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1e3 || timeout > MAX_TIMEOUT_MS) throw new TypeError(`PRIORSEAL_X402_TIMEOUT_MS must be between 1000 and ${MAX_TIMEOUT_MS}`);
  return timeout;
}
function parseNetworkSelection(value, allowTestnets) {
  if (!value) return { networks: X402_NETWORKS.map((network) => network.network), networksExplicitlyConfigured: false };
  const networks = value.split(",").map((network) => network.trim());
  const supportedNetworks = allowTestnets ? X402_STAGING_NETWORKS : X402_NETWORKS;
  if (!networks.length || networks.some((network) => !network) || networks.length > supportedNetworks.length || new Set(networks).size !== networks.length) throw new TypeError("PRIORSEAL_X402_NETWORKS must be a comma-separated list of unique supported CAIP-2 networks");
  const supported = new Set(supportedNetworks.map((network) => network.network));
  if (networks.some((network) => !supported.has(network))) throw new TypeError("PRIORSEAL_X402_NETWORKS contains an unsupported payment network");
  return { networks, networksExplicitlyConfigured: true };
}
function parseTestnetNetworkFlag(value, runtimeEnvironment) {
  if (!value) return false;
  if (value !== "true" && value !== "false") throw new TypeError("PRIORSEAL_X402_ENABLE_TESTNETS must be true or false");
  if (value === "false") return false;
  const environment = runtimeEnvironment?.trim() || "development";
  if (!["staging", "test", "development"].includes(environment)) throw new TypeError("PRIORSEAL_X402_ENABLE_TESTNETS is allowed only in staging, test, or development");
  return true;
}
async function getSupportedNetworks(config, parentSignal) {
  const urls = [...new Set(config.networks.map((network) => facilitatorFor(config, network)))];
  const cacheKey = JSON.stringify([urls, config.facilitatorHeaders.supported ?? {}, config.facilitatorAuth?.provider ?? "", config.facilitatorAuth?.apiKeyId ?? ""]);
  const cached = capabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = Promise.all(urls.map(async (url) => parseSupported(await facilitatorJson(config, "supported", void 0, parentSignal, url)))).then((responses) => {
    const networks = /* @__PURE__ */ new Set();
    for (const response of responses) for (const network of response.networks) networks.add(network);
    const solanaUrl = facilitatorFor(config, SOLANA_MAINNET_CAIP2);
    const solanaFeePayer = urls.includes(solanaUrl) ? responses[urls.indexOf(solanaUrl)].solanaFeePayer : null;
    return { networks, solanaFeePayer };
  });
  capabilityCache.set(cacheKey, { expiresAt: Date.now() + 6e4, promise });
  try {
    return await promise;
  } catch (error) {
    capabilityCache.delete(cacheKey);
    throw error;
  }
}
function parseSupported(value) {
  if (!isRecord(value) || !Array.isArray(value.kinds)) throw new Error("Configured facilitator returned an invalid supported response");
  const kinds = value.kinds;
  for (const kind of kinds) if (!isRecord(kind) || typeof kind.x402Version !== "number" || typeof kind.scheme !== "string" || typeof kind.network !== "string") throw new Error("Configured facilitator returned an invalid supported response");
  return {
    networks: new Set(kinds.filter((kind) => kind.x402Version === 2 && kind.scheme === "exact").map((kind) => kind.network)),
    solanaFeePayer: solanaFeePayerFromSupported(value)
  };
}
function solanaFeePayerFromSupported(value) {
  if (value.signers === void 0) return null;
  if (!isRecord(value.signers)) throw new Error("Configured facilitator returned invalid signer metadata");
  const relevant = [value.signers[SOLANA_MAINNET_CAIP2], value.signers["solana:*"]];
  const candidates = [];
  for (const group of relevant) {
    if (group === void 0) continue;
    if (!Array.isArray(group) || !group.every(isSolanaPublicKey)) throw new Error("Configured facilitator returned invalid Solana signer metadata");
    candidates.push(...group);
  }
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}
async function facilitatorJson(config, operation, body, parentSignal, urlOverride) {
  const url = urlOverride ?? config.facilitatorUrl;
  const target = operation === "supported" ? `${url}/supported` : `${url}/${operation}`;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) throw parentSignal.reason;
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Facilitator request timed out")), config.timeoutMs);
  try {
    const authHeaders = url === config.facilitatorUrl && config.facilitatorAuth ? await cdpFacilitatorAuthHeaders(config.facilitatorAuth, operation) : {};
    const response = await fetch(target, {
      method: operation === "supported" ? "GET" : "POST",
      // Cloudflare Workers does not implement redirect: 'error'. Manual mode
      // preserves the same fail-closed rule across both supported runtimes.
      redirect: "manual",
      headers: { "content-type": "application/json", ...authHeaders, ...config.facilitatorHeaders[operation] },
      ...operation === "supported" ? {} : { body: JSON.stringify(body) },
      signal: controller.signal
    });
    const text = await readLimitedText(response, MAX_FACILITATOR_RESPONSE_BYTES);
    if (response.status >= 300 && response.status < 400) throw new Error(`Configured facilitator ${operation} attempted an unexpected redirect`);
    if (!response.ok) throw new Error(`Configured facilitator ${operation} failed with HTTP ${response.status}`);
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`Configured facilitator ${operation} returned invalid JSON`);
    }
    assertSafeJson(result);
    return result;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}
async function readLimitedText(response, maxBytes) {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new Error("Configured facilitator response exceeds the allowed size");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Configured facilitator response exceeds the allowed size");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}
function decodePaymentHeader(value) {
  if (value.length > PAYMENT_HEADER_LIMIT || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError("Invalid PAYMENT-SIGNATURE header");
  const decoded = atob(value);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError("Invalid PAYMENT-SIGNATURE header");
  }
  assertSafeJson(parsed);
  if (!isRecord(parsed) || parsed.x402Version !== 2 || !isRecord(parsed.accepted) || !isRecord(parsed.payload) || parsed.resource !== void 0 && !isRecord(parsed.resource) || parsed.extensions !== void 0 && !isRecord(parsed.extensions)) throw new TypeError("Invalid PAYMENT-SIGNATURE payload");
  const accepted = parsed.accepted;
  if (accepted.scheme !== "exact" || typeof accepted.network !== "string" || typeof accepted.amount !== "string" || typeof accepted.asset !== "string" || typeof accepted.payTo !== "string" || !Number.isSafeInteger(accepted.maxTimeoutSeconds) || !isStringRecord(accepted.extra)) throw new TypeError("Invalid PAYMENT-SIGNATURE accepted requirements");
  return parsed;
}
function matchesRequirement(accepted, requirement) {
  const svm = requirement.network === SOLANA_MAINNET_CAIP2;
  return accepted.scheme === requirement.scheme && accepted.network === requirement.network && accepted.amount === requirement.amount && (svm ? accepted.asset === requirement.asset : accepted.asset.toLowerCase() === requirement.asset.toLowerCase()) && (svm ? accepted.payTo === requirement.payTo : accepted.payTo.toLowerCase() === requirement.payTo.toLowerCase()) && accepted.maxTimeoutSeconds === requirement.maxTimeoutSeconds && sameStringRecord(accepted.extra, requirement.extra);
}
function validSettlementTransaction(value, network) {
  if (network !== SOLANA_MAINNET_CAIP2) return /^0x[0-9a-fA-F]{64}$/.test(value);
  try {
    return decodeBase58(value).length === 64;
  } catch {
    return false;
  }
}
function encodeBase64Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function optional(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}
function sameStringRecord(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export {
  X402_EVM_NETWORKS,
  X402_NETWORKS,
  X402_SOLANA_NETWORKS,
  X402_STAGING_EVM_NETWORKS,
  X402_STAGING_NETWORKS,
  createX402PaymentService,
  matchX402Route,
  parseX402Config
};
