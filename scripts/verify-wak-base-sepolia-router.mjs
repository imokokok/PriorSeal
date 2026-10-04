// Generated from verify-wak-base-sepolia-router.mts by npm run core:build:tools. Do not edit directly.
import { createPublicClient, encodeFunctionData, http, keccak256, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
const RPCS = [
  process.env.BASE_RPC || "https://base-sepolia-rpc.publicnode.com",
  process.env.BASE_RPC2 || "https://sepolia.base.org"
];
const CHAIN_ID = 84532;
const ZERO = "0x0000000000000000000000000000000000000000";
const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const OFFICIAL = {
  factory: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
  swapRouter02: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
  quoterV2: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
  multicall: "0xd867e273eAbD6c853fCd0Ca0bFB6a3aE6491d2C1"
};
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEV_ACCOUNT = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const SELECTORS = {
  "414bf389": "exactInputSingle 8-word (original V3 SwapRouter, tuple HAS deadline)",
  "04e45aaf": "exactInputSingle 7-word (SwapRouter02 variant, NO deadline)",
  "5ae401dc": "multicall(uint256 deadline,bytes[] data)",
  "1f0464d1": "multicall(bytes32 deadline,bytes[] data)"
};
const V1_CANDIDATES = [
  "0x2626664c2603336E57B271c5C0b26F421741e481",
  "0x6E7a5FAFcec6bb1e78bAE2A1a0e31294eFbE1D1"
];
function push4Selectors(bytecodeHex) {
  const bytes = Buffer.from(bytecodeHex.slice(2), "hex");
  const found = /* @__PURE__ */ new Set();
  for (let i = 0; i < bytes.length - 4; i += 1) {
    if (bytes[i] === 99) found.add(bytes.slice(i + 1, i + 5).toString("hex"));
  }
  return found;
}
async function inspect(client, address, label) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return { address, label, deployed: false };
  const selectors = push4Selectors(code);
  return {
    address,
    label,
    deployed: true,
    bytes: (code.length - 2) / 2,
    codeHash: keccak256(code),
    selectorCount: selectors.size,
    has: Object.fromEntries(Object.keys(SELECTORS).map((s) => [s, selectors.has(s)]))
  };
}
function format(result) {
  if (!result.deployed) return `  ${result.address}  ${result.label}
     => NO CODE on ${CHAIN_ID}`;
  const selectorLines = Object.entries(SELECTORS).map(([sel, meaning]) => `     ${sel} ${result.has?.[sel] ? "PRESENT" : "absent "}  ${meaning}`).join("\n");
  return [
    `  ${result.address}  ${result.label}`,
    `     bytes=${result.bytes}  keccak256=${result.codeHash}  push4_selectors=${result.selectorCount}`,
    selectorLines
  ].join("\n");
}
function shortError(error) {
  const e = error;
  return (e.details || e.shortMessage || e.message || String(error)).split("\n")[0];
}
const clients = RPCS.map((url) => createPublicClient({ chain: baseSepolia, transport: http(url) }));
console.log(`Base Sepolia (${CHAIN_ID}) router independent verification`);
console.log(`RPC sources: ${RPCS.join(" | ")}
`);
let now = BigInt(Math.floor(Date.now() / 1e3));
try {
  const head = await clients[0].getBlock({ blockTag: "latest" });
  now = head.timestamp;
  console.log(`head block=${head.number}  timestamp=${head.timestamp}
`);
} catch (error) {
  console.log(`head read FAILED: ${shortError(error)}
`);
}
console.log("[1] cross-RPC agreement on SwapRouter02");
const fromPrimary = await inspect(clients[0], OFFICIAL.swapRouter02, "SwapRouter02 (official Base Sepolia)");
const fromSecondary = await inspect(clients[1], OFFICIAL.swapRouter02, "SwapRouter02 (second RPC)");
console.log(format(fromPrimary));
console.log(`     cross-RPC byte-identical: ${fromPrimary.codeHash === fromSecondary.codeHash ? "YES" : "NO \u2014 DO NOT TRUST"}`);
const impl = await clients[0].getStorageAt({ address: OFFICIAL.swapRouter02, slot: ERC1967_IMPL_SLOT });
const isProxy = Boolean(impl) && !/^0x0*$/.test(impl);
console.log(`
[2] ERC-1967 implementation slot: ${impl}`);
console.log(`     is proxy: ${isProxy ? "YES \u2014 must also pin implementation" : "no (runtime is the full logic)"}`);
console.log("\n[3] original V1 SwapRouter candidates on 84532");
for (const address of V1_CANDIDATES) {
  try {
    console.log(format(await inspect(clients[0], address, "V1 candidate")));
  } catch (error) {
    console.log(`  ${address}  V1 candidate
     => RPC ERROR: ${shortError(error)}`);
  }
}
console.log("\n[4] deadline carrier (SwapRouter02 own multicall vs official Multicall)");
console.log(format(await inspect(clients[0], OFFICIAL.multicall, "official Multicall")));
console.log("\n[5] WETH/USDC pools on 84532");
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const liquidityAbi = parseAbi(["function liquidity() view returns (uint128)"]);
for (const fee of [100, 500, 3e3, 1e4]) {
  try {
    const pool = await clients[0].readContract({
      address: OFFICIAL.factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [WETH, USDC, fee]
    });
    if (pool === ZERO) {
      console.log(`  fee=${fee}  NO POOL`);
      continue;
    }
    let liquidity = "unreadable";
    try {
      liquidity = (await clients[0].readContract({ address: pool, abi: liquidityAbi, functionName: "liquidity" })).toString();
    } catch {
    }
    console.log(`  fee=${fee}  pool=${pool}  liquidity=${liquidity}`);
  } catch (error) {
    console.log(`  fee=${fee}  ERR ${shortError(error).slice(0, 80)}`);
  }
}
console.log("\n[6] selector constant self-check (viem encodeFunctionData)");
const abi8 = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"]);
const abi7 = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"]);
const wordsOf = (data) => (data.length - 2 - 8) / 64;
const d8 = encodeFunctionData({
  abi: abi8,
  functionName: "exactInputSingle",
  args: [{
    tokenIn: `0x${"11".repeat(20)}`,
    tokenOut: `0x${"22".repeat(20)}`,
    fee: 3e3,
    recipient: `0x${"33".repeat(20)}`,
    deadline: 1n,
    amountIn: 1n,
    amountOutMinimum: 1n,
    sqrtPriceLimitX96: 0n
  }]
});
const d7 = encodeFunctionData({
  abi: abi7,
  functionName: "exactInputSingle",
  args: [{
    tokenIn: `0x${"11".repeat(20)}`,
    tokenOut: `0x${"22".repeat(20)}`,
    fee: 3e3,
    recipient: `0x${"33".repeat(20)}`,
    amountIn: 1n,
    amountOutMinimum: 1n,
    sqrtPriceLimitX96: 0n
  }]
});
console.log(`  8-word tuple => ${d8.slice(0, 10)}  words=${wordsOf(d8)}`);
console.log(`  7-word tuple => ${d7.slice(0, 10)}  words=${wordsOf(d7)}`);
console.log("\n[7] deadline semantics probe (eth_call, read-only)");
const inner = encodeFunctionData({
  abi: abi7,
  functionName: "exactInputSingle",
  args: [{
    tokenIn: WETH,
    tokenOut: USDC,
    fee: 3e3,
    recipient: DEV_ACCOUNT,
    amountIn: 1000000000000000n,
    amountOutMinimum: 1n,
    sqrtPriceLimitX96: 0n
  }]
});
console.log(`  inner 7-word call: ${inner.slice(0, 10)} (${wordsOf(inner)} words)`);
try {
  await clients[0].call({ to: OFFICIAL.swapRouter02, data: inner, value: 0n, account: DEV_ACCOUNT });
  console.log("  bare 7-word exactInputSingle => eth_call OK (shape accepted by router)");
} catch (error) {
  console.log(`  bare 7-word => ${shortError(error).slice(0, 110)}`);
}
const abiMulticall = parseAbi(["function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)"]);
for (const [label, deadline] of [
  ["multicall deadline = now+600", now + 600n],
  ["multicall deadline = now-1 (stale, negative case)", now - 1n]
]) {
  const outer = encodeFunctionData({ abi: abiMulticall, functionName: "multicall", args: [deadline, [inner]] });
  try {
    await clients[0].call({ to: OFFICIAL.swapRouter02, data: outer, value: 0n, account: DEV_ACCOUNT });
    console.log(`  ${label} => OK`);
  } catch (error) {
    console.log(`  ${label} => ${shortError(error).slice(0, 110)}`);
  }
}
console.log("\nConclusion:");
console.log("- \u82E5 [1] 414bf389 absent \u800C 04e45aaf present\uFF0C\u5219\u6211\u65B9 8 \u8BCD profile \u65E0\u6CD5\u5728\u8BE5\u5730\u5740\u88AB\u63A5\u7EB3\uFF0C");
console.log("  \u4E14\u6839\u56E0\u662F router \u6307\u5411\u800C\u975E\u7F16\u7801\u9519\u8BEF\u3002");
console.log("- \u82E5 [7] now+600 \u901A\u8FC7\u800C now-1 \u88AB\u62D2\uFF0C\u5219 deadline \u8BED\u4E49\u5DF2\u7531\u8BE5 router \u81EA\u8EAB\u7684 multicall\u627F\u8F7D\uFF0C");
console.log("  \u65E0\u9700 V1 SwapRouter\uFF0C\u4E5F\u65E0\u9700\u5916\u90E8 Multicall \u5408\u7EA6\u3002");
