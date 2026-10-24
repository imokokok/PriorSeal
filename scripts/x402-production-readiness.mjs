// Generated from x402-production-readiness.mts by npm run core:build:operations. Do not edit directly.
import { loadRuntimeConfig } from "../src/bootstrap/runtime-config.mjs";
import { createX402PaymentService } from "../src/infrastructure/payments/x402-exact-evm.mjs";
import { pathToFileURL } from "node:url";
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15e3;
async function runX402ProductionReadiness(environment = process.env, log = console.log) {
  if (environment.PRIORSEAL_ENVIRONMENT !== "production") throw new TypeError("Set PRIORSEAL_ENVIRONMENT=production before running the x402 production readiness check");
  const config = loadRuntimeConfig(environment);
  if (!config.x402 || !config.x402.networksExplicitlyConfigured || !config.x402.networks.length) throw new TypeError("Production x402 readiness requires an explicitly configured payment allowlist");
  if (config.x402.testnetNetworksEnabled || config.x402.networks.some((network) => network === "eip155:84532")) throw new TypeError("Production x402 readiness rejects testnet payment rails");
  const x402 = config.x402;
  const paymentService = createX402PaymentService(x402);
  const probes = [];
  for (const route of x402.routes) {
    const probePath = route.path.replace(/:[A-Za-z][A-Za-z0-9_]*/g, "x402-production-probe");
    const probeResourceUrl = new URL(probePath, x402.resourceOrigin).toString();
    const localChallenge = await paymentService.prepare(route, probeResourceUrl, void 0, AbortSignal.timeout(TIMEOUT_MS));
    if (localChallenge.kind !== "required") throw new TypeError("Local production x402 probe did not produce a payment challenge");
    assertBazaarDiscovery(localChallenge.response, route, probeResourceUrl);
    probes.push({ route, probeResourceUrl, localChallenge });
  }
  const capabilities = await readJson(new URL("/v1/capabilities", x402.resourceOrigin).toString());
  const payments = nested(capabilities.body, ["payments", "x402"]);
  if (!payments || payments.configured !== true) throw new TypeError("Production API does not report x402 as configured");
  assertExactNetworks(networksFromCapabilities(payments), x402.networks, "production API capabilities");
  assertRoutes(payments.routes, x402.routes);
  for (const probe of probes) {
    const remoteChallenge = await readJson(probe.probeResourceUrl, { expectStatus: 402 });
    if (remoteChallenge.headers.has("payment-response")) throw new TypeError("Unpaid production x402 probe unexpectedly returned PAYMENT-RESPONSE");
    const encodedHeader = remoteChallenge.headers.get("payment-required");
    if (!encodedHeader) throw new TypeError("Production x402 payment challenge is missing PAYMENT-REQUIRED");
    assertEquivalentChallenges(probe.localChallenge.response, remoteChallenge.body, probe.route, probe.probeResourceUrl);
    assertEquivalentChallenges(decodeBase64Json(encodedHeader, "PAYMENT-REQUIRED"), remoteChallenge.body, probe.route, probe.probeResourceUrl);
  }
  log(JSON.stringify({
    ready: true,
    environment: config.environment,
    resourceOrigin: new URL(x402.resourceOrigin).origin,
    routes: x402.routes.map((route) => route.path),
    networks: [...x402.networks].sort(),
    checks: ["facilitator-supported", "production-capabilities", "production-402-challenge", "payment-required-header-match", "bazaar-discovery-metadata"],
    settlementAttempted: false
  }));
}
async function readJson(url, { expectStatus = 200 } = {}) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status !== expectStatus) throw new TypeError(`Production x402 readiness probe received HTTP ${response.status}, expected ${expectStatus}`);
  const text = await readLimitedText(response);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new TypeError("Production x402 readiness probe returned invalid JSON");
  }
  if (!isRecord(body)) throw new TypeError("Production x402 readiness probe returned a non-object JSON body");
  return { body, headers: response.headers };
}
async function readLimitedText(response) {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) throw new TypeError("Production x402 readiness response exceeds the size limit");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TypeError("Production x402 readiness response exceeds the size limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function assertEquivalentChallenges(expected, actual, route, resourceUrl) {
  if (expected.x402Version !== 2 || actual.x402Version !== 2 || expected.error !== "Payment required" || actual.error !== "Payment required") throw new TypeError("Production x402 challenge has an unexpected envelope");
  const expectedResource = requireRecord(expected.resource, "Local payment resource is invalid");
  const actualResource = requireRecord(actual.resource, "Production payment resource is invalid");
  if (expectedResource.url !== resourceUrl || actualResource.url !== resourceUrl || JSON.stringify(expectedResource) !== JSON.stringify(actualResource)) throw new TypeError("Production x402 challenge resource differs from the configured route");
  assertBazaarDiscovery(expected, route, resourceUrl);
  assertBazaarDiscovery(actual, route, resourceUrl);
  const expectedAccepts = normalizedRequirements(expected.accepts);
  const actualAccepts = normalizedRequirements(actual.accepts);
  if (JSON.stringify(expectedAccepts) !== JSON.stringify(actualAccepts)) throw new TypeError("Production x402 challenge requirements differ from the configured facilitator quote");
}
function assertBazaarDiscovery(challenge, route, resourceUrl) {
  const resource = requireRecord(challenge.resource, "x402 Bazaar challenge resource is invalid");
  const resourceOrigin = new URL(resourceUrl).origin;
  if (resource.serviceName !== "PriorSeal Evidence API" || JSON.stringify(resource.tags) !== JSON.stringify(["agent-evidence", "authorization", "execution", "verification", "x402"]) || resource.iconUrl !== new URL("/priorseal-mark.svg", resourceOrigin).toString()) throw new TypeError("x402 Bazaar service metadata is invalid");
  const extensions = requireRecord(challenge.extensions, "x402 Bazaar challenge has no extensions");
  const bazaar = requireRecord(extensions.bazaar, "x402 Bazaar challenge has no Bazaar extension");
  const info = requireRecord(bazaar.info, "x402 Bazaar challenge has invalid discovery info");
  const input = requireRecord(info.input, "x402 Bazaar challenge has invalid input metadata");
  const output = requireRecord(info.output, "x402 Bazaar challenge has invalid output metadata");
  const schema = requireRecord(bazaar.schema, "x402 Bazaar challenge has invalid schema metadata");
  const pathParams = routePathParams(route.path, resourceUrl);
  if (input.type !== "http" || input.method !== route.method || JSON.stringify(input.pathParams ?? {}) !== JSON.stringify(pathParams)) throw new TypeError("x402 Bazaar challenge input metadata differs from the configured route");
  if (output.type !== "json" || output.format !== outputFormat(route.path) || !isRecord(output.example)) throw new TypeError("x402 Bazaar challenge output metadata differs from the configured route");
  if (Object.keys(pathParams).length && bazaar.routeTemplate !== route.path) throw new TypeError("x402 Bazaar challenge route template differs from the configured route");
  if (!Object.keys(pathParams).length && bazaar.routeTemplate !== void 0) throw new TypeError("x402 Bazaar challenge unexpectedly declares a route template");
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || schema.type !== "object" || !isRecord(schema.properties) || !Array.isArray(schema.required) || !schema.required.includes("input")) throw new TypeError("x402 Bazaar challenge schema is invalid");
  const inputSchema = requireRecord(schema.properties.input, "x402 Bazaar challenge input schema is invalid");
  if (!Array.isArray(inputSchema.required) || !inputSchema.required.includes("type") || !inputSchema.required.includes("method") || Object.keys(pathParams).length && !inputSchema.required.includes("pathParams")) throw new TypeError("x402 Bazaar challenge input schema does not validate its declared input");
}
function routePathParams(routePath, resourceUrl) {
  const template = routePath.replace(/\/+$/, "").split("/");
  const actual = new URL(resourceUrl).pathname.replace(/\/+$/, "").split("/");
  const result = {};
  for (let index = 0; index < template.length; index += 1) if (template[index].startsWith(":") && actual[index]) result[template[index].slice(1)] = decodeURIComponent(actual[index]);
  return result;
}
function outputFormat(path) {
  if (path.endsWith("/bundle")) return "priorseal.verification-bundle.v1";
  if (path.endsWith("/check")) return "priorseal.fresh-evidence-check.v1";
  if (path.startsWith("/v1/evidence/receipts/")) return "priorseal.evidence.v1";
  if (path === "/v1/integration-readiness") return "priorseal.integration-readiness.v1";
  return "application/json";
}
function normalizedRequirements(value) {
  if (!Array.isArray(value) || !value.length) throw new TypeError("x402 payment challenge has no accepted requirements");
  return value.map((entry) => {
    const requirement = requireRecord(entry, "x402 payment challenge contains an invalid requirement");
    if (requirement.scheme !== "exact" || typeof requirement.network !== "string" || typeof requirement.amount !== "string" || !/^\d+$/.test(requirement.amount) || typeof requirement.asset !== "string" || typeof requirement.payTo !== "string" || !Number.isSafeInteger(requirement.maxTimeoutSeconds) || !isRecord(requirement.extra) || !Object.values(requirement.extra).every((item) => typeof item === "string")) throw new TypeError("x402 payment challenge contains an invalid requirement");
    return { scheme: requirement.scheme, network: requirement.network, amount: requirement.amount, asset: requirement.asset, payTo: requirement.payTo, maxTimeoutSeconds: requirement.maxTimeoutSeconds, extra: Object.fromEntries(Object.entries(requirement.extra).sort(([left], [right]) => left.localeCompare(right))) };
  }).sort((left, right) => left.network.localeCompare(right.network));
}
function networksFromCapabilities(value) {
  const networks = value.networks;
  if (!Array.isArray(networks)) throw new TypeError("Production API x402 capabilities have no network list");
  return networks.map((entry) => {
    const network = requireRecord(entry, "Production API x402 capabilities contain an invalid network");
    if (typeof network.network !== "string") throw new TypeError("Production API x402 capabilities contain an invalid network");
    return network.network;
  });
}
function assertExactNetworks(actual, expected, source) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (new Set(normalizedActual).size !== normalizedActual.length || normalizedActual.length !== normalizedExpected.length || normalizedActual.some((network, index) => network !== normalizedExpected[index])) throw new TypeError(`${source} does not exactly match the configured x402 allowlist`);
}
function assertRoutes(value, expected) {
  if (!Array.isArray(value) || value.length !== expected.length) throw new TypeError("Production API x402 capabilities have an unexpected paid-route schedule");
  for (let index = 0; index < expected.length; index += 1) {
    const route = requireRecord(value[index], "Production API x402 capabilities contain an invalid paid route");
    const configured = expected[index];
    if (route.method !== configured.method || route.path !== configured.path || route.description !== configured.description || route.price !== configured.price) throw new TypeError("Production API x402 capabilities paid-route schedule differs from configuration");
  }
}
function decodeBase64Json(header, name) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new TypeError(`${name} header is not base64 JSON`);
  }
  return requireRecord(parsed, `${name} header is not a JSON object`);
}
function nested(value, path) {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return isRecord(current) ? current : null;
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requireRecord(value, message) {
  if (!isRecord(value)) throw new TypeError(message);
  return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runX402ProductionReadiness();
export {
  runX402ProductionReadiness
};
