/**
 * WAK 合作线：Base Sepolia (84532) swap 路由独立核验。
 *
 * 背景（2026-10-04 23:16 Maulana 来信争点）：对方称 10-04 草案所用
 * `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` 是 SwapRouter02 而非原版 V3
 * SwapRouter，故我方 8 词 exactInputSingle selector `0x414bf389` 永不可能在那里
 * 被接纳，要求我方给出 84532 上V1 SwapRouter 地址。
 *
 * 本脚本不采信任何一方声明，全部现场从链上读回：
 *   1. 两个独立 RPC 交叉核 SwapRouter02 的 runtime bytecode 与 keccak256；
 *   2. ERC-1967 implementation slot（是否为代理）；
 *   3. 官方未列84532 V1 地址，故逐一实测 V1 候选是否部署；
 *   4. deadline 载体：SwapRouter02 自身是否带multicall；
 *   5. WETH/USDC 各 fee 档池与流动性是否存在；
 *   6. 用viem 反推 selector 常量，防止脚本自身硬编码错误；
 *   7. 只读 eth_call 实测 deadline 语义（未来 deadline 通过 / 过期被拒）。
 *
 * 全程只读，不签名、不广播、不消耗 nonce。
 *
 * 用法：npm run verify:wak-base-sepolia:router
 * 可选环境变量：BASE_RPC / BASE_RPC2 覆盖默认两个独立 RPC。
 */

import { createPublicClient, encodeFunctionData, http, keccak256, parseAbi, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';

const RPCS = [
  process.env.BASE_RPC || 'https://base-sepolia-rpc.publicnode.com',
  process.env.BASE_RPC2 || 'https://sepolia.base.org',
];

const CHAIN_ID = 84532;
const ZERO = '0x0000000000000000000000000000000000000000';
const ERC1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

// Uniswap 官方 Base Sepolia 部署（docs.uniswap.org base-deployments）。
// 注意：该表此角色只列SwapRouter02，没有原版 V1 SwapRouter 行。
const OFFICIAL = {
  factory: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
  swapRouter02: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
  quoterV2: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
  multicall: '0xd867e273eAbD6c853fCd0Ca0bFB6a3aE6491d2C1',
} as const;

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const DEV_ACCOUNT = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';

/** 关键 selector 及其含义。字面量必须与 [6] 的 viem 反推结果一致。 */
const SELECTORS: Record<string, string> = {
  '414bf389': 'exactInputSingle 8-word (original V3 SwapRouter, tuple HAS deadline)',
  '04e45aaf': 'exactInputSingle 7-word (SwapRouter02 variant, NO deadline)',
  '5ae401dc': 'multicall(uint256 deadline,bytes[] data)',
  '1f0464d1': 'multicall(bytes32 deadline,bytes[] data)',
};

/** 官方未列84532 的 V1 SwapRouter，逐一实测而不是假设存在。 */
const V1_CANDIDATES: readonly Address[] = [
  '0x2626664c2603336E57B271c5C0b26F421741e481',
  '0x6E7a5FAFcec6bb1e78bAE2A1a0e31294eFbE1D1',
];

type Inspection = {
  address: Address;
  label: string;
  deployed: boolean;
  bytes?: number;
  codeHash?: `0x${string}`;
  selectorCount?: number;
  has?: Record<string, boolean>;
};

/** 扫描 runtime bytecode 的 PUSH4 (0x63) 常量作为 function selector 集合。 */
function push4Selectors(bytecodeHex: `0x${string}`): Set<string> {
  const bytes = Buffer.from(bytecodeHex.slice(2), 'hex');
  const found = new Set<string>();
  for (let i = 0; i < bytes.length - 4; i += 1) {
    if (bytes[i] === 0x63) found.add(bytes.slice(i + 1, i + 5).toString('hex'));
  }
  return found;
}

async function inspect(
  client: (typeof clients)[number],
  address: Address,
  label: string,
): Promise<Inspection> {
  const code = await client.getCode({ address });
  if (!code || code === '0x') return { address, label, deployed: false };
  const selectors = push4Selectors(code);
  return {
    address,
    label,
    deployed: true,
    bytes: (code.length - 2) / 2,
    codeHash: keccak256(code),
    selectorCount: selectors.size,
    has: Object.fromEntries(Object.keys(SELECTORS).map((s) => [s, selectors.has(s)])),
  };
}

function format(result: Inspection): string {
  if (!result.deployed) return `  ${result.address}  ${result.label}\n     => NO CODE on ${CHAIN_ID}`;
  const selectorLines = Object.entries(SELECTORS)
    .map(([sel, meaning]) => `     ${sel} ${result.has?.[sel] ? 'PRESENT' : 'absent '}  ${meaning}`)
    .join('\n');
  return [
    `  ${result.address}  ${result.label}`,
    `     bytes=${result.bytes}  keccak256=${result.codeHash}  push4_selectors=${result.selectorCount}`,
    selectorLines,
  ].join('\n');
}

function shortError(error: unknown): string {
  const e = error as { details?: string; shortMessage?: string; message?: string };
  return (e.details || e.shortMessage || e.message || String(error)).split('\n')[0];
}

const clients = RPCS.map((url) => createPublicClient({ chain: baseSepolia, transport: http(url) }));

console.log(`Base Sepolia (${CHAIN_ID}) router independent verification`);
console.log(`RPC sources: ${RPCS.join(' | ')}\n`);

let now = BigInt(Math.floor(Date.now() / 1000));
try {
  const head = await clients[0].getBlock({ blockTag: 'latest' });
  now = head.timestamp;
  console.log(`head block=${head.number}  timestamp=${head.timestamp}\n`);
} catch (error) {
  console.log(`head read FAILED: ${shortError(error)}\n`);
}

// [1] 交叉核：两个独立 RPC 读同一地址，bytecode 必须逐字节一致
console.log('[1] cross-RPC agreement on SwapRouter02');
const fromPrimary = await inspect(clients[0], OFFICIAL.swapRouter02, 'SwapRouter02 (official Base Sepolia)');
const fromSecondary = await inspect(clients[1], OFFICIAL.swapRouter02, 'SwapRouter02 (second RPC)');
console.log(format(fromPrimary));
console.log(`     cross-RPC byte-identical: ${fromPrimary.codeHash === fromSecondary.codeHash ? 'YES' : 'NO — DO NOT TRUST'}`);

// [2] 代理检查：只 pin 代理 runtime 而未 pin 实现是文档已知的缺口
const impl = await clients[0].getStorageAt({ address: OFFICIAL.swapRouter02, slot: ERC1967_IMPL_SLOT });
const isProxy = Boolean(impl) && !/^0x0*$/.test(impl as string);
console.log(`\n[2] ERC-1967 implementation slot: ${impl}`);
console.log(`     is proxy: ${isProxy ? 'YES — must also pin implementation' : 'no (runtime is the full logic)'}`);

// [3] V1 SwapRouter 候选：官方 Base Sepolia 无地址，实测逐一确认
console.log('\n[3] original V1 SwapRouter candidates on 84532');
for (const address of V1_CANDIDATES) {
  try {
    console.log(format(await inspect(clients[0], address, 'V1 candidate')));
  } catch (error) {
    console.log(`  ${address}  V1 candidate\n     => RPC ERROR: ${shortError(error)}`);
  }
}

// [4] deadline 载体：SwapRouter02 自身是否带 multicall
console.log('\n[4] deadline carrier (SwapRouter02 own multicall vs official Multicall)');
console.log(format(await inspect(clients[0], OFFICIAL.multicall, 'official Multicall')));

// [5] 交易对池：WETH/USDC 各 fee 档是否真的存在
console.log('\n[5] WETH/USDC pools on 84532');
const factoryAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)']);
const liquidityAbi = parseAbi(['function liquidity() view returns (uint128)']);
for (const fee of [100, 500, 3000, 10000]) {
  try {
    const pool = await clients[0].readContract({
      address: OFFICIAL.factory, abi: factoryAbi, functionName: 'getPool', args: [WETH, USDC, fee],
    });
    if (pool === ZERO) {
      console.log(`  fee=${fee}  NO POOL`);
      continue;
    }
    let liquidity = 'unreadable';
    try {
      liquidity = (await clients[0].readContract({ address: pool, abi: liquidityAbi, functionName: 'liquidity' })).toString();
    } catch { /* 保留 unreadable，不伪造数值 */ }
    console.log(`  fee=${fee}  pool=${pool}  liquidity=${liquidity}`);
  } catch (error) {
    console.log(`  fee=${fee}  ERR ${shortError(error).slice(0, 80)}`);
  }
}

// [6] selector 常量自检，避免脚本自身写错字面量
console.log('\n[6] selector constant self-check (viem encodeFunctionData)');
const abi8 = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)']);
const abi7 = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)']);
/** calldata 字数：d.length 是十六进制字符数，先转字节再减去 4 字节 selector。 */
const wordsOf = (data: `0x${string}`): number => (data.length - 2 - 8) / 64;
const d8 = encodeFunctionData({
  abi: abi8, functionName: 'exactInputSingle',
  args: [{
    tokenIn: `0x${'11'.repeat(20)}`, tokenOut: `0x${'22'.repeat(20)}`, fee: 3000,
    recipient: `0x${'33'.repeat(20)}`, deadline: 1n, amountIn: 1n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
  }],
});
const d7 = encodeFunctionData({
  abi: abi7, functionName: 'exactInputSingle',
  args: [{
    tokenIn: `0x${'11'.repeat(20)}`, tokenOut: `0x${'22'.repeat(20)}`, fee: 3000,
    recipient: `0x${'33'.repeat(20)}`, amountIn: 1n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
  }],
});
console.log(`  8-word tuple => ${d8.slice(0, 10)}  words=${wordsOf(d8)}`);
console.log(`  7-word tuple => ${d7.slice(0, 10)}  words=${wordsOf(d7)}`);

// [7] deadline 语义实测：只读 eth_call，不签名不广播
//     这是决定能否留在 SwapRouter02 的关键：不必换 V1 router也能拿到 deadline。
console.log('\n[7] deadline semantics probe (eth_call, read-only)');
const inner = encodeFunctionData({
  abi: abi7, functionName: 'exactInputSingle',
  args: [{
    tokenIn: WETH, tokenOut: USDC, fee: 3000, recipient: DEV_ACCOUNT,
    amountIn: 1_000_000_000_000_000n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
  }],
});
console.log(`  inner 7-word call: ${inner.slice(0, 10)} (${wordsOf(inner)} words)`);
try {
  await clients[0].call({ to: OFFICIAL.swapRouter02, data: inner, value: 0n, account: DEV_ACCOUNT });
  console.log('  bare 7-word exactInputSingle => eth_call OK (shape accepted by router)');
} catch (error) {
  console.log(`  bare 7-word => ${shortError(error).slice(0, 110)}`);
}
const abiMulticall = parseAbi(['function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)']);
for (const [label, deadline] of [
  ['multicall deadline = now+600', now + 600n],
  ['multicall deadline = now-1 (stale, negative case)', now - 1n],
] as const) {
  const outer = encodeFunctionData({ abi: abiMulticall, functionName: 'multicall', args: [deadline, [inner]] });
  try {
    await clients[0].call({ to: OFFICIAL.swapRouter02, data: outer, value: 0n, account: DEV_ACCOUNT });
    console.log(`  ${label} => OK`);
  } catch (error) {
    console.log(`  ${label} => ${shortError(error).slice(0, 110)}`);
  }
}

console.log('\nConclusion:');
console.log('- 若 [1] 414bf389 absent 而 04e45aaf present，则我方 8 词 profile 无法在该地址被接纳，');
console.log('  且根因是 router 指向而非编码错误。');
console.log('- 若 [7] now+600 通过而 now-1 被拒，则 deadline 语义已由该 router 自身的 multicall承载，');
console.log('  无需 V1 SwapRouter，也无需外部 Multicall 合约。');
