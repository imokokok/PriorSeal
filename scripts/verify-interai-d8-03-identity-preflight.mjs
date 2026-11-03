#!/usr/bin/env node
// Generated from verify-interai-d8-03-identity-preflight.mts by npm run core:build:tools. Do not edit directly.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeFunctionResult, encodeFunctionData, keccak256 } from "viem";
const CHAIN_ID = "0x14a34";
const DEFAULT_RPC_URL = "https://sepolia.base.org";
const DEFAULT_BLOCK_NUMBER = 53773606n;
const DEFAULT_BLOCK_HASH = "0xa9e3cd6072983c9b10208a7f3abecf5c5cd07a8a7d84268bacc2094647037df8";
const ROUTER = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4";
const QUOTER = "0xc5290058841028f1614f3a6f0f5816cad0df5e27";
const FACTORY = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const FEE = 3e3;
const ERC20_ABI = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }];
const FACTORY_ABI = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] }];
const POOL_ABI = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }] }
];
const ROUTER_ABI = [{ type: "function", name: "exactInputSingle", stateMutability: "payable", inputs: [{ type: "tuple", components: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" }, { name: "recipient", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }], outputs: [{ type: "uint256" }] }];
function required(value, flag) {
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}
function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? void 0 : required(process.argv[index + 1], name);
}
function hex(number) {
  return `0x${number.toString(16)}`;
}
function lower(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError(`${label} is not an address`);
  return value.toLowerCase();
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function json(value) {
  return `${JSON.stringify(value, (_key, current) => typeof current === "bigint" ? current.toString() : current, 2)}
`;
}
const rpcUrl = argument("--rpc") ?? DEFAULT_RPC_URL;
const blockNumber = BigInt(argument("--block-number") ?? DEFAULT_BLOCK_NUMBER.toString());
const expectedBlockHash = (argument("--block-hash") ?? DEFAULT_BLOCK_HASH).toLowerCase();
const outputPath = argument("--out");
let requestCount = 0;
const requests = [];
async function requestRpc(payload) {
  try {
    return await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(2e4)
    });
  } catch (directError) {
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
    if (!proxy) throw new Error("Direct RPC request failed and no configured local proxy is available", { cause: directError });
    const hostname = new URL(proxy).hostname;
    if (hostname !== "127.0.0.1" && hostname !== "localhost") {
      throw new Error("Direct RPC request failed; configured proxy is not local", { cause: directError });
    }
    try {
      const response = execFileSync("curl", [
        "--fail",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "10",
        "--max-time",
        "20",
        "--proxy",
        proxy,
        "--request",
        "POST",
        rpcUrl,
        "--header",
        "content-type: application/json",
        "--data-binary",
        payload
      ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
      return new Response(response, { status: 200 });
    } catch {
      throw new Error("Direct RPC request and configured local-proxy retry both failed");
    }
  }
}
async function rpc(method, params) {
  const id = ++requestCount;
  requests.push({ method, params });
  const response = await requestRpc(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status}`);
  const body = await response.json();
  if (body.jsonrpc !== "2.0" || body.id !== id || body.error || body.result === void 0) {
    throw new Error(`${method} returned an invalid RPC response: ${body.error?.message ?? "missing result"}`);
  }
  return body.result;
}
function selector(blockHash) {
  return { blockHash, requireCanonical: true };
}
async function call(address, data, blockHash) {
  const result = await rpc("eth_call", [{ to: address, data }, selector(blockHash)]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) throw new TypeError("eth_call did not return hex data");
  return result;
}
async function code(address, blockHash) {
  const result = await rpc("eth_getCode", [address, selector(blockHash)]);
  if (typeof result !== "string" || result === "0x") throw new Error(`${address} has no deployed code at the reference block`);
  return result;
}
function check(name, pass, detail) {
  return { name, pass, detail };
}
const chainId = await rpc("eth_chainId", []);
const referenceBlock = await rpc("eth_getBlockByNumber", [hex(blockNumber), false]);
const finalizedBlock = await rpc("eth_getBlockByNumber", ["finalized", false]);
if (typeof referenceBlock.hash !== "string" || typeof referenceBlock.number !== "string" || typeof referenceBlock.timestamp !== "string") throw new Error("Reference block is malformed");
const referenceHash = referenceBlock.hash.toLowerCase();
if (referenceHash !== expectedBlockHash) throw new Error(`Reference block hash mismatch: expected ${expectedBlockHash}, got ${referenceHash}`);
if (referenceBlock.number.toLowerCase() !== hex(blockNumber)) throw new Error("Reference block number mismatch");
if (typeof finalizedBlock.number !== "string" || BigInt(finalizedBlock.number) < blockNumber) throw new Error("Reference block is not finalized by the configured endpoint");
const [routerCode, quoterCode, factoryCode, wethCode, usdcCode] = await Promise.all([
  code(ROUTER, referenceHash),
  code(QUOTER, referenceHash),
  code(FACTORY, referenceHash),
  code(WETH, referenceHash),
  code(USDC, referenceHash)
]);
const factoryPoolData = encodeFunctionData({ abi: FACTORY_ABI, functionName: "getPool", args: [WETH, USDC, FEE] });
const pool = lower(decodeFunctionResult({ abi: FACTORY_ABI, functionName: "getPool", data: await call(FACTORY, factoryPoolData, referenceHash) }), "factory pool");
if (pool === "0x0000000000000000000000000000000000000000") throw new Error("Factory returned the zero pool address");
const poolCode = await code(pool, referenceHash);
const decimalsData = encodeFunctionData({ abi: ERC20_ABI, functionName: "decimals" });
const [wethDecimals, usdcDecimals, poolFactory, token0, token1, poolFee, slot0] = await Promise.all([
  call(WETH, decimalsData, referenceHash).then((data) => decodeFunctionResult({ abi: ERC20_ABI, functionName: "decimals", data })),
  call(USDC, decimalsData, referenceHash).then((data) => decodeFunctionResult({ abi: ERC20_ABI, functionName: "decimals", data })),
  call(pool, encodeFunctionData({ abi: POOL_ABI, functionName: "factory" }), referenceHash).then((data) => lower(decodeFunctionResult({ abi: POOL_ABI, functionName: "factory", data }), "pool factory")),
  call(pool, encodeFunctionData({ abi: POOL_ABI, functionName: "token0" }), referenceHash).then((data) => lower(decodeFunctionResult({ abi: POOL_ABI, functionName: "token0", data }), "pool token0")),
  call(pool, encodeFunctionData({ abi: POOL_ABI, functionName: "token1" }), referenceHash).then((data) => lower(decodeFunctionResult({ abi: POOL_ABI, functionName: "token1", data }), "pool token1")),
  call(pool, encodeFunctionData({ abi: POOL_ABI, functionName: "fee" }), referenceHash).then((data) => decodeFunctionResult({ abi: POOL_ABI, functionName: "fee", data })),
  call(pool, encodeFunctionData({ abi: POOL_ABI, functionName: "slot0" }), referenceHash).then((data) => decodeFunctionResult({ abi: POOL_ABI, functionName: "slot0", data }))
]);
const roundTrip = encodeFunctionData({
  abi: ROUTER_ABI,
  functionName: "exactInputSingle",
  args: [{ tokenIn: WETH, tokenOut: USDC, fee: FEE, recipient: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc", amountIn: 1000000000000000n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }]
});
const selectorChecks = requests.filter((entry) => ["eth_getCode", "eth_call"].includes(entry.method)).every((entry) => {
  const reference = entry.params.at(-1);
  return typeof reference === "object" && reference !== null && reference.blockHash === referenceHash && reference.requireCanonical === true;
});
const sqrtPriceX96 = Array.isArray(slot0) ? slot0[0] : 0n;
const checks = [
  check("chain-id", chainId === CHAIN_ID, `expected ${CHAIN_ID}, got ${String(chainId)}`),
  check("reference-block-number", referenceBlock.number.toLowerCase() === hex(blockNumber), String(referenceBlock.number)),
  check("reference-block-hash", referenceHash === expectedBlockHash, referenceHash),
  check("reference-block-finalized", BigInt(finalizedBlock.number) >= blockNumber, String(finalizedBlock.number)),
  ...[["router", routerCode], ["quoterV2", quoterCode], ["factory", factoryCode], ["weth", wethCode], ["usdc", usdcCode], ["pool", poolCode]].map(([name, value]) => check(`${name}-code`, typeof value === "string" && value !== "0x", `keccak256=${keccak256(value)}`)),
  check("weth-decimals", wethDecimals === 18, String(wethDecimals)),
  check("usdc-decimals", usdcDecimals === 6, String(usdcDecimals)),
  check("factory-pool", pool !== "0x0000000000000000000000000000000000000000", pool),
  check("pool-factory", poolFactory === FACTORY, poolFactory),
  check("pool-token0", token0 === USDC, token0),
  check("pool-token1", token1 === WETH, token1),
  check("pool-fee", poolFee === FEE, String(poolFee)),
  check("pool-initialized", typeof sqrtPriceX96 === "bigint" && sqrtPriceX96 > 0n, String(sqrtPriceX96)),
  check("exact-input-single-selector", roundTrip.slice(0, 10) === "0x04e45aaf", roundTrip.slice(0, 10)),
  check("all-state-reads-eip-1898-canonical", selectorChecks, "blockHash + requireCanonical:true")
];
const report = {
  schema: "interai.d8-03.identity-preflight-report.v1",
  disposition: checks.every((entry) => entry.pass) ? "IDENTITY_PREFLIGHT_PASS_NOT_D8_03_CLEARANCE" : "IDENTITY_PREFLIGHT_FAILED",
  scope: "READ_ONLY_IDENTITY_ONLY",
  prohibitions: ["no quote", "no capture", "no signing", "no /verify", "no execution", "no broadcast"],
  rpc: { endpoint: new URL(rpcUrl).origin, requestCount, fallbackUsed: false },
  referenceBlock: { number: blockNumber.toString(), hash: referenceHash, timestamp: Number(BigInt(referenceBlock.timestamp)) },
  contracts: { router: { address: ROUTER, codeKeccak256: keccak256(routerCode) }, quoterV2: { address: QUOTER, codeKeccak256: keccak256(quoterCode) }, factory: { address: FACTORY, codeKeccak256: keccak256(factoryCode) }, weth: { address: WETH, codeKeccak256: keccak256(wethCode), decimals: wethDecimals }, usdc: { address: USDC, codeKeccak256: keccak256(usdcCode), decimals: usdcDecimals }, pool: { address: pool, codeKeccak256: keccak256(poolCode), fee: poolFee } },
  checks,
  residualRequirements: [
    "Contract bytecode identity is not deployed-build provenance: independently verify QuoterV2 source, compiler metadata, and deployment transaction/address provenance before treating this profile as cleared.",
    "A real non-canonical-fork rejection has not been demonstrated. Require an archival provider and a documented orphan block hash for a negative EIP-1898 requireCanonical test before D8-03 clearance.",
    "Public sender/recipient and A/B minimum-output rules remain a bilateral capture convention; this identity-only preflight does not authorize or establish them."
  ],
  reportSha256: ""
};
const unsigned = json(report);
report.reportSha256 = sha256(unsigned);
const bytes = json(report);
if (outputPath) {
  await writeFile(resolve(outputPath), bytes);
  process.stdout.write(`${resolve(outputPath)}
`);
} else {
  process.stdout.write(bytes);
}
