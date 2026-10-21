// Generated from agent-retail-readiness.mts by npm run core:build:operations. Do not edit directly.
import { pathToFileURL } from "node:url";
const MAX_RESPONSE_BYTES = 128 * 1024;
const TIMEOUT_MS = 2e4;
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function record(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be a JSON object`);
  return value;
}
function string(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
  return value;
}
function nested(value, path, label) {
  let current = value;
  for (const key of path) {
    assert(current !== null && typeof current === "object" && !Array.isArray(current), `${label} is missing`);
    current = current[key];
  }
  return record(current, label);
}
async function readLimitedJson(response, label) {
  const length = response.headers.get("content-length");
  assert(!length || /^\d+$/.test(length) && Number(length) <= MAX_RESPONSE_BYTES, `${label} exceeds the response size limit`);
  const reader = response.body?.getReader();
  assert(reader, `${label} has no response body`);
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value: value2 } = await reader.read();
    if (done) break;
    size += value2.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`${label} exceeds the response size limit`);
    }
    chunks.push(value2);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return record(value, label);
}
async function runAgentRetailReadiness({ env = process.env, fetcher = fetch, log = console.log } = {}) {
  const baseUrl = new URL(env.PRIORSEAL_BASE_URL ?? "https://priorseal.xyz");
  assert(!baseUrl.username && !baseUrl.password, "Base URL must not contain credentials");
  assert(baseUrl.protocol === "https:" || ["localhost", "127.0.0.1"].includes(baseUrl.hostname), "HTTPS is required outside local development");
  let getRequests = 0;
  async function get(path, expectedStatus = 200) {
    const url = new URL(path, baseUrl);
    assert(url.origin === baseUrl.origin, "Readiness check refuses to leave the configured origin");
    getRequests += 1;
    const response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    assert(response.status === expectedStatus, `GET ${url.pathname} returned HTTP ${response.status}; expected ${expectedStatus}`);
    return { body: await readLimitedJson(response, `GET ${url.pathname}`), headers: response.headers };
  }
  const live = await get("/health/live");
  const ready = await get("/health/ready");
  const version = await get("/v1/version");
  const capabilities = await get("/v1/capabilities");
  const agent = await get("/.well-known/priorseal-agent.json");
  assert(live.body.status === "ok", "Liveness is not healthy");
  assert(ready.body.status === "ready" && ready.body.storage === "d1", "Durable storage is not ready");
  const releaseVersion = string(version.body.version, "Release version");
  assert(/^[0-9a-f]{40}$/.test(releaseVersion), "Release version is not an immutable Git SHA");
  assert(version.body.service === "priorseal", "Version endpoint is not PriorSeal");
  assert(!version.headers.has("x-render-origin-server") && !version.headers.has("rndr-id"), "Readiness request reached a retired origin");
  assert(capabilities.body.schema === "priorseal.capabilities.v1", "Capabilities schema is unavailable");
  assert(capabilities.body.workflowReady === true, "PriorSeal workflow is not ready");
  const dependencies = nested(capabilities.body, ["dependencies"], "Capabilities dependencies");
  assert(dependencies.issuer === "configured" && dependencies.storage === "available", "Issuer or durable storage is unavailable");
  const agentCredits = nested(capabilities.body, ["payments", "agentCredits"], "Agent credits capability");
  assert(agentCredits.configured === true, "Operator-issued Agent service credits are unavailable");
  const publicPaidCommerce = nested(capabilities.body, ["payments", "publicPaidCommerce"], "Public paid-commerce capability");
  assert(publicPaidCommerce.enabled === false && publicPaidCommerce.mode === "PILOT_OPERATOR_MANAGED", "Public paid commerce is unexpectedly enabled during the pilot");
  const selfserveClaim = nested(capabilities.body, ["payments", "selfserveClaim"], "Self-serve claim capability");
  assert(selfserveClaim.configured === false, "Self-serve paid credit claims are unexpectedly enabled during the pilot");
  const x402 = nested(capabilities.body, ["payments", "x402"], "x402 capability");
  assert(x402.configured === false && Array.isArray(x402.routes) && x402.routes.length === 0, "x402 payment acceptance is unexpectedly enabled during the pilot");
  assert(agent.body.schema === "priorseal.agent-integration.v1" && agent.body.service === "PriorSeal", "Agent discovery document is unavailable");
  assert(agent.body.version === releaseVersion, "Agent discovery document version differs from the deployed release");
  const safety = nested(agent.body, ["safety"], "Agent discovery safety boundary");
  assert(safety.executionMode === "PROPOSAL_AND_PRINCIPAL_CONFIRMATION", "Agent discovery does not require principal confirmation");
  assert(safety.principalSignature === "REQUIRED_FOR_EVERY_EXACT_ACTION" && safety.transactionSigningKey === "NEVER_REQUESTED_BY_PRIORSEAL", "Agent discovery weakens the signing boundary");
  const result = {
    ok: true,
    schema: "priorseal.agent-retail-readiness.v1",
    mode: "PUBLIC_READ_ONLY_GET",
    baseUrl: baseUrl.origin,
    version: releaseVersion,
    agentCredits: "CONFIGURED",
    selfserveClaim: "OPERATOR_MANAGED_ONLY",
    x402: "DISABLED_FOR_PILOT",
    getRequests,
    writesPerformed: 0,
    walletOrTransactionSignatures: 0
  };
  log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runAgentRetailReadiness();
export {
  runAgentRetailReadiness
};
