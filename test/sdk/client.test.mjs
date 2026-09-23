// Generated from client.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { PriorSealApiError, buildExactCallIntent, createPriorSealClient, generateAuthorizationNonce } from "../../sdk/dist/index.js";
import { keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { authorizationTypedData, buildAuthorization } from "../../src/index.mjs";
function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseRequestBody(body) {
  if (typeof body !== "string") throw new TypeError("Expected a JSON string request body");
  const parsed = JSON.parse(body);
  if (!isRecord(parsed)) throw new TypeError("Expected a JSON object request body");
  return parsed;
}
test("SDK maps typed methods to the PriorSeal API and sends stable idempotency keys", async () => {
  const calls = [];
  const client = createPriorSealClient({ baseUrl: "https://priorseal.test/", idempotencyKey: () => "idem-fixed", fetch: async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return response({ observation: { chainId: 8453, txHash: "0x1", status: "PENDING" }, receipt: null });
  } });
  const result = await client.observeExecution({ authorizationId: "auth_1", chainId: 8453, txHash: "0x1" });
  assert.equal(result.observation.status, "PENDING");
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "https://priorseal.test/v1/executions/observe");
  assert.equal(new Headers(call.init.headers).get("idempotency-key"), "idem-fixed");
  assert.deepEqual(parseRequestBody(call.init.body), { authorizationId: "auth_1", chainId: 8453, txHash: "0x1", confirmations: 0 });
});
test("SDK binds the browser global fetch implementation", async () => {
  const originalFetch = globalThis.fetch;
  let receiver;
  globalThis.fetch = async function() {
    receiver = this;
    return response({ status: "ok" });
  };
  try {
    const client = createPriorSealClient();
    assert.equal((await client.health()).status, "ok");
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("SDK retrieves transparency evidence and observation jobs from encoded paths", async () => {
  const paths = [];
  const client = createPriorSealClient({ fetch: async (url) => {
    paths.push(String(url));
    return paths.length === 1 ? response({ checkpoint: { size: 1 }, chain: [] }) : response({ jobId: "job/1", state: "QUEUED", attempts: 0, input: {}, observation: null, error: null });
  } });
  await client.getTransparencyEvidence("auth/1");
  const job = await client.getObservationJob("job/1");
  assert.equal(job.state, "QUEUED");
  assert.deepEqual(paths, ["/v1/authorizations/auth%2F1/transparency", "/v1/observation-jobs/job%2F1"]);
});
test("SDK exposes structured API errors without losing server codes", async () => {
  const client = createPriorSealClient({ fetch: async () => response({ error: { code: "AUTHORIZATION_EXPIRED", message: "Expired", details: { at: 10 } } }, 410) });
  await assert.rejects(() => client.getAuthorization("auth_expired"), (error) => error instanceof PriorSealApiError && error.code === "AUTHORIZATION_EXPIRED" && error.status === 410 && isRecord(error.details) && error.details.at === 10);
});
test("SDK wallet helper prepares, signs and accepts an authorization", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 15e5 });
  const signer = privateKeyToAccount(generatePrivateKey());
  const account = signer.address.toLowerCase();
  const authorization = buildAuthorization({ schema: "priorseal.authorization.v2", domain: "priorseal/authorization/v2", intent: { intentId: "intent_1", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "1", sender: account, recipient: `0x${"b".repeat(40)}`, validUntil: 2e3 }, principal: { type: "user", id: "user:1", account }, authorizer: { type: "eip712", address: account }, delegate: { agentId: "agent:1", executor: account }, issuedAt: 1e3, notBefore: 1e3, expiresAt: 2e3, authorizationNonce: `0x${"1".repeat(64)}`, maxUses: "1", audience: "priorseal", policyHash: `0x${"0".repeat(64)}` });
  const requests = [];
  const client = createPriorSealClient({ fetch: async (url, init) => {
    requests.push({ url: String(url), body: parseRequestBody(init?.body) });
    if (String(url).endsWith("/prepare")) return response({ authorization, typedData: JSON.parse(JSON.stringify(authorizationTypedData(authorization), (_key, value) => typeof value === "bigint" ? value.toString() : value)) });
    return response({ authorization: parseRequestBody(init?.body), acceptance: { authorizationId: authorization.authorizationId, status: "ACCEPTED" }, policy: { allowed: true, reasonCodes: [], policyId: null } }, 201);
  } });
  const provider = { async request({ method, params }) {
    if (method === "eth_requestAccounts") return [account];
    if (typeof params?.[1] !== "string") throw new TypeError("Expected serialized typed data");
    return signer.signTypedData(JSON.parse(params[1]));
  } };
  const flow = await client.authorizeWithWallet({ intent: authorization.intent, principal: { type: "user", id: "user:1" }, delegate: authorization.delegate, issuedAt: 1e3, authorizationNonce: authorization.authorizationNonce }, provider);
  assert.equal(flow.account, account);
  assert.match(flow.signature, /^0x[0-9a-f]{130}$/);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.body.signature, flow.signature);
  assert.match(generateAuthorizationNonce(), /^0x[0-9a-f]{64}$/);
});
test("SDK builds canonical exact-call intents with external context commitments", () => {
  const data = "0x1234";
  const intent = buildExactCallIntent({
    transaction: { chainId: 8453, from: `0x${"a".repeat(40)}`, to: `0x${"b".repeat(40)}`, data, value: 0n, nonce: 7n },
    intentId: "exact-sdk-1",
    asset: `eip155:8453/erc20:0x${"c".repeat(40)}`,
    amount: 1000000n,
    validUntil: 2e9,
    contextCommitments: [
      { namespace: "treasury.approval.v1", algorithm: "sha256", digest: `0x${"2".repeat(64)}` },
      { namespace: "insight.pretrade-pair.v1", algorithm: "keccak256", digest: `0x${"1".repeat(64)}` }
    ]
  });
  assert.equal(intent.calldataHash, keccak256(data));
  assert.equal(intent.transactionValue, "0");
  assert.equal(intent.nonce, "7");
  assert.deepEqual(intent.contextCommitments?.map((entry) => entry.namespace), ["insight.pretrade-pair.v1", "treasury.approval.v1"]);
});
test("SDK waits for a durable observation job and returns its final receipt", async () => {
  let polls = 0;
  const receipt = { receiptId: "psr-final", execution: { status: "CONFIRMED" } };
  const client = createPriorSealClient({ fetch: async (url) => {
    if (String(url).endsWith("/v1/executions/observe")) return response({ observation: { chainId: 8453, txHash: "0x1", status: "PENDING" }, receipt: null, observationJob: { jobId: "job-1", state: "QUEUED" } });
    polls += 1;
    return polls === 1 ? response({ jobId: "job-1", state: "RETRY_WAIT", attempts: 1, input: {}, observation: { status: "PENDING" }, result: null, error: null }) : response({ jobId: "job-1", state: "COMPLETED", attempts: 2, input: {}, observation: { status: "CONFIRMED" }, result: { observation: { chainId: 8453, txHash: "0x1", status: "CONFIRMED" }, receipt, verification: { valid: true, code: "OK" } }, error: null });
  } });
  const result = await client.observeExecutionUntilFinal({ authorizationId: "auth-1", chainId: 8453, txHash: "0x1" }, { pollIntervalMs: 10, timeoutMs: 100 });
  assert.ok(result.receipt);
  assert.ok(result.observationJob);
  assert.equal(result.receipt.receiptId, "psr-final");
  assert.equal(result.observation.status, "CONFIRMED");
  assert.equal(result.observationJob.state, "COMPLETED");
});
test("SDK waits until the retry is due without repeatedly fetching the same job", async () => {
  const nextAttemptAt = Date.now() + 100;
  const pollTimes = [];
  const client = createPriorSealClient({ fetch: async () => {
    pollTimes.push(Date.now());
    return response({ jobId: "job-retry", state: Date.now() >= nextAttemptAt ? "COMPLETED" : "RETRY_WAIT", nextAttemptAt, input: {}, observation: null, result: null, error: null });
  } });
  const job = await client.waitForObservationJob("job-retry", { pollIntervalMs: 10, timeoutMs: 1e3 });
  assert.equal(job.state, "COMPLETED");
  assert.ok(pollTimes.length <= 3, `Expected at most three polls, received ${pollTimes.length}`);
  assert.ok((pollTimes.at(-1) ?? 0) >= nextAttemptAt);
});
test("SDK polling remains abortable while waiting for a retry", async () => {
  const controller = new AbortController();
  const client = createPriorSealClient({ fetch: async () => response({ jobId: "job-retry", state: "RETRY_WAIT", nextAttemptAt: Date.now() + 6e4, input: {} }) });
  const waiting = client.waitForObservationJob("job-retry", { pollIntervalMs: 10, timeoutMs: 12e4, signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(waiting, { code: "REQUEST_ABORTED" });
});
