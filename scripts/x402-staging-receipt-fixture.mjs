// Generated from x402-staging-receipt-fixture.mts by npm run core:build:operations. Do not edit directly.
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { authorizationTypedData, buildAuthorization } from "../src/domain/authorization.mjs";
import { createPublicClient, encodeFunctionData, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
const CONFIRMATION_FLAG = "--confirm-single-execution";
const ORIGIN = "https://priorseal-staging.priorseal.workers.dev";
const CHAIN_ID = 84532;
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY_TO = "0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231";
const AMOUNT = 1n;
const TRANSFER_ABI = [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "success", type: "bool" }] }];
if (Number(process.versions.node.split(".")[0]) < 22) throw new TypeError("x402 staging receipt fixture requires Node.js 22 or newer");
if (process.argv.length !== 3 || process.argv[2] !== CONFIRMATION_FLAG) throw new TypeError(`Refusing to prepare or broadcast. Rerun with ${CONFIRMATION_FLAG} after an explicit GO.`);
const payerKey = process.env.X402_E2E_PRIVATE_KEY?.trim();
if (!payerKey || !/^0x[0-9a-fA-F]{64}$/.test(payerKey)) throw new TypeError("X402_E2E_PRIVATE_KEY must be a dedicated 32-byte 0x-prefixed Base Sepolia test-wallet key");
const rpc = parseEnvironment(readFileSync(".env.local", "utf8")).PRIORSEAL_RPC_BASE_SEPOLIA;
if (!rpc) throw new TypeError("PRIORSEAL_RPC_BASE_SEPOLIA is required in .env.local");
const payer = privateKeyToAccount(payerKey);
const authorizer = privateKeyToAccount(generatePrivateKey());
if (payer.address.toLowerCase() === authorizer.address.toLowerCase()) throw new TypeError("Generated authorizer must differ from the executor");
const policy = {
  policyId: `priorseal-staging-bundle-${randomUUID()}`,
  principals: [{ id: `staging-bundle-${authorizer.address.slice(2, 10).toLowerCase()}`, type: "user", account: authorizer.address, authorizerType: "eip712" }],
  allowedChainIds: [CHAIN_ID],
  allowedActions: ["TRANSFER"],
  allowedAssets: [`eip155:${CHAIN_ID}/erc20:${ASSET.toLowerCase()}`],
  allowedSenders: [payer.address],
  allowedRecipients: [PAY_TO],
  maxAmount: AMOUNT.toString(),
  maxValiditySeconds: 900,
  minConfirmations: 1,
  requireDistinctAuthorizerAndExecutor: true,
  timestampPolicy: {
    schema: "priorseal.timestamp-policy.v1",
    profile: "digicert-rfc3161-v1",
    maxClockSkewSeconds: 300
  }
};
putStagingPolicy(policy);
console.log(JSON.stringify({ stage: "policy-updated", policyId: policy.policyId, authorizer: authorizer.address, executor: payer.address, amount: AMOUNT.toString() }));
const client = createPublicClient({ chain: baseSepolia, transport: http(rpc, { retryCount: 0, timeout: 15e3 }) });
if (await client.getChainId() !== CHAIN_ID) throw new TypeError("Configured RPC is not Base Sepolia");
const nonce = await client.getTransactionCount({ address: payer.address, blockTag: "pending" });
const now = Math.floor(Date.now() / 1e3);
const intent = {
  schema: "priorseal.intent.v1",
  intentId: `x402-staging-bundle-${randomUUID()}`,
  chainId: CHAIN_ID,
  action: "TRANSFER",
  asset: `eip155:${CHAIN_ID}/erc20:${ASSET.toLowerCase()}`,
  amount: AMOUNT.toString(),
  sender: payer.address,
  recipient: PAY_TO,
  validUntil: now + 600,
  nonce: String(nonce),
  constraints: { minConfirmations: 1 }
};
const prepared = await requestJson("/v1/authorizations/prepare", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    intent,
    principal: { type: "user", id: policy.principals[0].id, account: authorizer.address },
    authorizer: { type: "eip712", address: authorizer.address },
    delegate: { agentId: "x402-staging-bundle-rehearsal", executor: payer.address },
    issuedAt: now,
    notBefore: now,
    expiresAt: intent.validUntil,
    authorizationNonce: `0x${randomBytes(32).toString("hex")}`,
    maxUses: "1"
  })
});
const draft = buildAuthorization(record(prepared.authorization, "Authorization preparation response is invalid"));
const authorization = buildAuthorization({ ...draft, signature: await authorizer.signTypedData(authorizationTypedData(draft)) });
const accepted = await requestJson("/v1/authorizations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(authorization) });
const acceptedAuthorization = record(accepted.authorization, "Authorization acceptance response is invalid");
const authorizationId = string(acceptedAuthorization.authorizationId, "Authorization acceptance is missing authorizationId");
console.log(JSON.stringify({ stage: "authorization-accepted", authorizationId, intentId: intent.intentId }));
const data = encodeFunctionData({ abi: TRANSFER_ABI, functionName: "transfer", args: [PAY_TO, AMOUNT] });
const [gas, fees] = await Promise.all([
  client.estimateGas({ account: payer.address, to: ASSET, data }),
  client.estimateFeesPerGas()
]);
if (fees.maxFeePerGas === void 0 || fees.maxPriorityFeePerGas === void 0) throw new TypeError("Base Sepolia EIP-1559 fee data is unavailable");
const serializedTransaction = await payer.signTransaction({
  chainId: CHAIN_ID,
  type: "eip1559",
  to: ASSET,
  data,
  value: 0n,
  nonce,
  gas: gas * 125n / 100n,
  maxFeePerGas: fees.maxFeePerGas,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas
});
const txHash = await client.sendRawTransaction({ serializedTransaction });
console.log(JSON.stringify({ stage: "execution-broadcast", txHash, amount: AMOUNT.toString() }));
const chainReceipt = await client.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 18e4 });
if (chainReceipt.status !== "success") throw new TypeError(`Test-USDC execution reverted: ${txHash}`);
const observed = await requestJson("/v1/executions/observe", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `x402-bundle-observe-${randomUUID()}` }, body: JSON.stringify({ authorizationId, chainId: CHAIN_ID, txHash, confirmations: 1 }) });
const receipt = record(observed.receipt, "Observation did not return a receipt");
const receiptId = string(receipt.receiptId, "Observation receipt is missing receiptId");
const binding = record(receipt.binding, "Observation receipt is missing binding");
if (receipt.executionStatus !== "CONFIRMED" || binding.bound !== true) throw new TypeError("Observation receipt is not a confirmed, bound execution");
console.log(JSON.stringify({ stage: "receipt-issued", receiptId, authorizationId, txHash, outcome: receipt.outcome, executionStatus: receipt.executionStatus }));
function putStagingPolicy(value) {
  const wrangler = resolve(fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)));
  runWrangler(wrangler, ["secret", "put", "PRIORSEAL_POLICY_JSON", "--env", "staging"], JSON.stringify(value), "update the staging rehearsal policy");
  runWrangler(wrangler, ["deploy", "--env", "staging"], void 0, "deploy the staging rehearsal policy");
}
function runWrangler(wrangler, args, input, operation) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: process.cwd(),
    ...input === void 0 ? {} : { input },
    encoding: "utf8",
    env: process.env
  });
  if (result.status !== 0) throw new TypeError(`Unable to ${operation}: ${safeOutput(result.stderr || result.stdout)}`);
}
async function requestJson(path, init) {
  const response = await fetch(new URL(path, ORIGIN), { ...init, redirect: "error", signal: AbortSignal.timeout(3e4) });
  const text = await response.text();
  if (!response.ok) throw new TypeError(`${path} returned HTTP ${response.status}: ${safeOutput(text)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(`${path} returned invalid JSON`);
  }
  return record(parsed, `${path} returned a non-object JSON body`);
}
function parseEnvironment(value) {
  return Object.fromEntries(value.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}
function record(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(message);
  return value;
}
function string(value, message) {
  if (typeof value !== "string" || !value) throw new TypeError(message);
  return value;
}
function safeOutput(value) {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 512);
}
