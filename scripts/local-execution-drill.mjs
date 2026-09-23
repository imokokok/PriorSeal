// Generated from local-execution-drill.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { privateKeyToAccount } from "viem/accounts";
import { createHttpServer, createPostgresStore } from "../src/index.mjs";
import { observeEvm } from "../src/infrastructure/blockchain/evm/observer.mjs";
import { createPriorSealClient, buildExactCallIntent } from "../sdk/dist/index.js";
import { verifyReceiptLocally } from "../sdk/dist/verifier.js";
import { openDurableState } from "../examples/durable-state/store.mjs";
if (!process.env.GANACHE_MODULE) throw new Error("Set GANACHE_MODULE to the installed ganache@7.9.2 core module; see docs/runbooks/reliability.md");
const { default: ganache } = await import(pathToFileURL(process.env.GANACHE_MODULE).href);
const chain = ganache.provider({ chain: { chainId: 8453 }, logging: { quiet: true }, wallet: { totalAccounts: 2 } });
const root = await mkdtemp(join(tmpdir(), "priorseal-execution-"));
let db = new PGlite(), server, state;
const keypair = generateKeyPairSync("ed25519");
const privateKeyPem = keypair.privateKey.export({ type: "pkcs8", format: "pem" });
const publicKeyPem = keypair.publicKey.export({ type: "spki", format: "pem" });
const issuer = "local-recovery-drill", audience = "local-recovery-drill";
let walletSignatures = 0, broadcasts = 0;
const startServer = async () => {
  const pool = { query: (sql, params) => db.query(sql, params), connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {
  } }) };
  server = createHttpServer({
    store: createPostgresStore(pool),
    privateKeyPem,
    publicKeyPem,
    issuer,
    keyId: "local-1",
    authorizationAudience: audience,
    observer: (input) => observeEvm({ ...input, rpcUrls: ["in-process-evm"], rpcClient: { call: async (_url, method, params) => await chain.request({ method, params }) } })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};
const stopServer = async () => {
  if (server?.listening) {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
};
const restart = async () => {
  await stopServer();
  const backup = await db.dumpDataDir();
  await db.close();
  db = new PGlite({ loadDataDir: backup });
  await state?.close();
  state = await openDurableState(root);
  return startServer();
};
try {
  for (const file of (await readdir(new URL("../migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  state = await openDurableState(root);
  let baseUrl = await startServer();
  const accounts = chain.getInitialAccounts();
  const [from, to] = Object.keys(accounts);
  const signer = privateKeyToAccount(accounts[from].secretKey);
  const wallet = { request: async ({ method, params }) => {
    assert.equal(method, "eth_signTypedData_v4");
    walletSignatures++;
    assert.ok(params && typeof params[1] === "string");
    return signer.signTypedData(JSON.parse(params[1]));
  } };
  const now = Math.floor(Date.now() / 1e3);
  const transaction = { from, to, chainId: 8453, nonce: 0, value: "0", data: "0x1234" };
  const intent = buildExactCallIntent({ transaction, intentId: "local-drill", asset: "eip155:8453/native", amount: "0", validUntil: now + 600, constraints: { minConfirmations: 1 } });
  const request = { intent, account: from, principal: { type: "user", id: "local-fixture" }, delegate: { agentId: "local-executor", executor: from }, issuedAt: now, expiresAt: now + 600, audience };
  let dropAcceptance = true;
  const client = createPriorSealClient({ baseUrl, fetch: async (url, options) => {
    const response = await fetch(url, options);
    if (dropAcceptance && String(url).endsWith("/v1/authorizations") && response.ok) {
      dropAcceptance = false;
      await response.text();
      throw new Error("Injected response loss after database commit");
    }
    return response;
  } });
  await assert.rejects(client.authorizeWithWallet(request, wallet, { onCheckpoint: (checkpoint) => state.save("authorization", checkpoint) }), { code: "NETWORK_ERROR" });
  assert.equal((await state.load("authorization"))?.stage, "SIGNED");
  baseUrl = await restart();
  const resumed = createPriorSealClient({ baseUrl });
  const authorization = await resumed.authorizeWithWallet(request, wallet, { checkpoint: await state.load("authorization") ?? void 0, onCheckpoint: (checkpoint) => state.save("authorization", checkpoint) });
  assert.equal(walletSignatures, 1);
  assert.equal(authorization.checkpoint.stage, "ACCEPTED");
  await chain.request({ method: "evm_increaseTime", params: [2] });
  broadcasts++;
  const txHashValue = await chain.request({ method: "eth_sendTransaction", params: [{ from, to, data: transaction.data, value: "0x0", gas: "0x10000" }] });
  assert.equal(typeof txHashValue, "string");
  const txHash = txHashValue;
  await state.save("execution", { authorizationId: authorization.checkpoint.prepared.authorization.authorizationId, chainId: 8453, txHash, confirmations: 1 });
  const observationInput = await state.load("execution");
  assert.ok(observationInput);
  const lostResponse = createPriorSealClient({ baseUrl, fetch: async (url, options) => {
    const response = await fetch(url, options);
    if (String(url).endsWith("/v1/executions/observe") && response.ok) {
      await response.text();
      throw new Error("Injected observation response loss");
    }
    return response;
  } });
  await assert.rejects(lostResponse.observeExecution(observationInput, { idempotencyKey: "drill-observation" }), { code: "NETWORK_ERROR" });
  baseUrl = await restart();
  const restoredInput = await state.load("execution");
  assert.ok(restoredInput);
  const result = await createPriorSealClient({ baseUrl }).observeExecution(restoredInput, { idempotencyKey: "drill-observation" });
  assert.ok(result.receipt?.compliance);
  assert.equal(result.receipt.compliance.status, "COMPLIANT");
  assert.equal(result.receipt.executionStatus, "CONFIRMED");
  const verified = await verifyReceiptLocally(result.receipt, { expectedAudience: audience, trustedKeys: { issuer, keyId: "local-1", algorithm: "Ed25519", publicKey: publicKeyPem, status: "active", validFrom: null, validUntil: null } });
  assert.equal(verified.valid, true);
  assert.equal(broadcasts, 1);
  assert.equal(await chain.request({ method: "eth_getTransactionCount", params: [from, "latest"] }), "0x1");
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM receipts")).rows[0].n), 1);
  console.log(JSON.stringify({ ok: true, scope: "ISOLATED_LOCAL_EVM_AND_POSTGRES_NOT_PRODUCTION_CHAIN", walletSignatures, broadcasts, databaseRestoreCycles: 2, receiptLocallyVerified: true, droppedAcceptanceRecovered: true, droppedObservationRecovered: true, issuerProofMode: "issuer-only local fixture; production RFC3161 is checked separately" }, null, 2));
} finally {
  await stopServer();
  await state?.close();
  await db.close();
  await chain.disconnect();
  await rm(root, { recursive: true, force: true });
}
