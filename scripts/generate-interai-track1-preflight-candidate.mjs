#!/usr/bin/env node

/**
 * Generate the read-only InterAI Track 1 Base Sepolia candidate package.
 *
 * This script never signs, approves, submits, or broadcasts a transaction. It
 * deliberately emits NO_RUN whenever a required readiness predicate is false.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  keccak256,
} from 'viem';
import { baseSepolia } from 'viem/chains';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORSEAL_ROOT = path.resolve(HERE, '..');
const INSIGHT_ROOT = path.resolve(PRIORSEAL_ROOT, '../insight');
const COLLAB_ROOT = path.resolve(PRIORSEAL_ROOT, '../partnerships/interai-collaboration');
const ATTACHMENT_DIR = path.join(COLLAB_ROOT, 'attachments/letter-32-track1-candidate-run-package');
const ARCHIVE_DIR = path.join(COLLAB_ROOT, 'file/2026-09-23-interai-track1-preflight-source-record');

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
const CHAIN_ID = 84532;
const ROUTER = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4';
const QUOTER = '0xC5290058841028F1614F3A6F0F5816cAd0df5E27';
const FACTORY = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const EXECUTOR = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const FEE = 3_000;
const AMOUNT_IN = 1_000_000_000_000_000n;
const MAX_SLIPPAGE_BPS = 500n;
const QUOTE_VALID_FOR_SECONDS = 60;

const KEYS_URL = 'https://www.oracleinsight.xyz/.well-known/oracle-keys.json';
const REGISTRY_CURRENT_URL =
  'https://www.oracleinsight.xyz/.well-known/oracle-registry/current.json';

const EXACT_INPUT_SINGLE_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
];

const QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
];

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
];

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
];

function iso(seconds) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function json(value) {
  return `${JSON.stringify(
    value,
    (_key, entry) => (typeof entry === 'bigint' ? entry.toString() : entry),
    2
  )}\n`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitHead(directory) {
  return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function writeBoth(name, bytes) {
  await Promise.all([
    writeFile(path.join(ATTACHMENT_DIR, name), bytes),
    writeFile(path.join(ARCHIVE_DIR, name), bytes),
  ]);
}

await Promise.all([
  mkdir(ATTACHMENT_DIR, { recursive: true }),
  mkdir(ARCHIVE_DIR, { recursive: true }),
]);

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL, { timeout: 30_000 }),
});

const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`Expected Base Sepolia ${CHAIN_ID}, received ${chainId}`);

const [block, pendingNonce, ethBalance, wethBalance, routerAllowance, pool, codes] =
  await Promise.all([
    client.getBlock({ blockTag: 'latest' }),
    client.getTransactionCount({ address: EXECUTOR, blockTag: 'pending' }),
    client.getBalance({ address: EXECUTOR }),
    client.readContract({ address: WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [EXECUTOR] }),
    client.readContract({
      address: WETH,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [EXECUTOR, ROUTER],
    }),
    client.readContract({
      address: FACTORY,
      abi: FACTORY_ABI,
      functionName: 'getPool',
      args: [WETH, USDC, FEE],
    }),
    Promise.all([ROUTER, QUOTER, FACTORY, WETH, USDC].map((address) => client.getCode({ address }))),
  ]);

if (codes.some((code) => !code || code === '0x')) throw new Error('A pinned contract has no bytecode');
if (pool === '0x0000000000000000000000000000000000000000')
  throw new Error('Pinned WETH/USDC fee-3000 pool is absent');

const quoteParams = {
  tokenIn: WETH,
  tokenOut: USDC,
  amountIn: AMOUNT_IN,
  fee: FEE,
  sqrtPriceLimitX96: 0n,
};
const quoteSimulation = await client.simulateContract({
  account: EXECUTOR,
  address: QUOTER,
  abi: QUOTER_ABI,
  functionName: 'quoteExactInputSingle',
  args: [quoteParams],
  blockNumber: block.number,
});
const [quotedAmountOut, sqrtPriceX96After, initializedTicksCrossed, quoteGasEstimate] =
  quoteSimulation.result;
const amountOutMinimum = (quotedAmountOut * (10_000n - MAX_SLIPPAGE_BPS)) / 10_000n;
const declaredAmountUsd = Math.max(1, Math.ceil(Number(formatUnits(quotedAmountOut, 6))));

const swapParams = {
  tokenIn: WETH,
  tokenOut: USDC,
  fee: FEE,
  recipient: EXECUTOR,
  amountIn: AMOUNT_IN,
  amountOutMinimum,
  sqrtPriceLimitX96: 0n,
};
const calldata = encodeFunctionData({
  abi: EXACT_INPUT_SINGLE_ABI,
  functionName: 'exactInputSingle',
  args: [swapParams],
});
const calldataHash = keccak256(calldata);

let simulation = { success: true, error: null };
try {
  await client.call({ account: EXECUTOR, to: ROUTER, data: calldata, value: 0n, blockNumber: block.number });
} catch (error) {
  simulation = {
    success: false,
    error: error instanceof Error ? error.shortMessage || error.message.split('\n')[0] : String(error),
  };
}

const [keysBytes, currentBytes] = await Promise.all([
  fetchBytes(KEYS_URL),
  fetchBytes(REGISTRY_CURRENT_URL),
]);
const registryCurrent = JSON.parse(currentBytes.toString('utf8'));
const releaseUrl = registryCurrent.release;
if (typeof releaseUrl !== 'string' || !releaseUrl.startsWith('https://www.oracleinsight.xyz/'))
  throw new Error('Registry current.json did not provide an approved immutable release URL');
const releaseBytes = await fetchBytes(releaseUrl);
const registryRelease = JSON.parse(releaseBytes.toString('utf8'));
if (registryRelease.releaseId !== registryCurrent.releaseId)
  throw new Error('Immutable release id does not match current pointer');

await Promise.all([
  writeBoth('oracle-keys.json', keysBytes),
  writeBoth('oracle-registry-current.json', currentBytes),
  writeBoth(`oracle-registry-release-${registryCurrent.releaseId}.json`, releaseBytes),
]);

const generatedAt = Math.floor(Date.now() / 1_000);
const quoteExpiresAt = generatedAt + QUOTE_VALID_FOR_SECONDS;
const insightCommit = gitHead(INSIGHT_ROOT);
const priorSealCommit = gitHead(PRIORSEAL_ROOT);
const blockingReasons = [];

if (wethBalance < AMOUNT_IN) blockingReasons.push('EXECUTOR_WETH_BALANCE_INSUFFICIENT');
if (routerAllowance < AMOUNT_IN) blockingReasons.push('ERC20_ALLOWANCE_NOT_ESTABLISHED');
if (!simulation.success) blockingReasons.push('EXACT_CALL_SIMULATION_FAILED');
blockingReasons.push('CURRENT_PRODUCTION_SIGNED_SOURCE_ASSERTION_NOT_ISSUED');
blockingReasons.push('CURRENT_PRODUCTION_SIGNED_DESTINATION_ASSERTION_NOT_ISSUED');

const packageDocument = {
  schema: 'interai.track1.non-broadcast-candidate-run-package.v1',
  packageId: `interai-track1-base-sepolia-${generatedAt}`,
  generatedAt,
  generatedAtIso: iso(generatedAt),
  purpose: 'HOST_BINDING_REVIEW_ONLY',
  preflightDisposition: 'NO_RUN',
  executionAuthorization: 'INTERAI_EXECUTABLE_ALLOW_NOT_ESTABLISHED',
  blockingReasons,
  prohibitions: {
    transactionSigning: true,
    erc20Approval: true,
    priorSealExecutionStep: true,
    baseSepoliaBroadcast: true,
    interaiCredentialExchange: true,
    authenticatedInteraiCall: true,
  },
  sourceCode: {
    insight: {
      repository: 'https://github.com/imokokok/Insight.git',
      commit: insightCommit,
    },
    priorSeal: {
      repository: 'https://github.com/imokokok/PriorSeal.git',
      commit: priorSealCommit,
    },
  },
  network: {
    name: 'Base Sepolia',
    chainId: CHAIN_ID,
    rpc: RPC_URL,
    quoteBlockNumber: Number(block.number),
    quoteBlockHash: block.hash,
    quoteBlockTimestamp: Number(block.timestamp),
    quoteBlockTimestampIso: iso(block.timestamp),
  },
  action: {
    action: 'wallet.send_transaction',
    actionType: 'evm_call',
    rpcMethod: 'eth_sendTransaction',
    executor: EXECUTOR,
    executorClassification: 'PUBLIC_TESTNET_DEV_ACCOUNT_DEDICATED_TO_THIS_CANDIDATE',
    executorWarning:
      'Public Hardhat development key; Base Sepolia only; never eligible for production value.',
    pendingNonce,
    target: ROUTER,
    value: '0',
    currency: 'USD',
    declared_amount_usd: declaredAmountUsd,
    calldata,
    calldataHash,
    interaiSixFieldProjection: {
      chainId: CHAIN_ID,
      sender: EXECUTOR,
      target: ROUTER,
      value: '0',
      calldataHash,
      nonce: String(pendingNonce),
    },
  },
  swap: {
    method: 'exactInputSingle',
    tokenIn: WETH,
    tokenOut: USDC,
    sourceAssetId: `eip155:${CHAIN_ID}/erc20:${WETH}`,
    destinationAssetId: `eip155:${CHAIN_ID}/erc20:${USDC}`,
    fee: FEE,
    recipient: EXECUTOR,
    amountIn: AMOUNT_IN.toString(),
    amountInDisplay: `${formatUnits(AMOUNT_IN, 18)} WETH`,
    amountOutMinimum: amountOutMinimum.toString(),
    sqrtPriceLimitX96: '0',
    maxSlippageBps: Number(MAX_SLIPPAGE_BPS),
  },
  quote: {
    venue: 'Uniswap V3 QuoterV2',
    quoter: QUOTER,
    factory: FACTORY,
    pool,
    quotedAmountOut: quotedAmountOut.toString(),
    quotedAmountOutDisplay: `${formatUnits(quotedAmountOut, 6)} USDC`,
    amountOutMinimum: amountOutMinimum.toString(),
    amountOutMinimumDisplay: `${formatUnits(amountOutMinimum, 6)} USDC`,
    sqrtPriceX96After: sqrtPriceX96After.toString(),
    initializedTicksCrossed,
    gasEstimate: quoteGasEstimate.toString(),
    observedAt: generatedAt,
    observedAtIso: iso(generatedAt),
    expiresAt: quoteExpiresAt,
    expiresAtIso: iso(quoteExpiresAt),
    validForSeconds: QUOTE_VALID_FOR_SECONDS,
    validAtGeneration: true,
    refreshRequiredBeforeAnyAuthenticatedPreflight: true,
  },
  executorReadiness: {
    ethBalanceWei: ethBalance.toString(),
    ethBalanceDisplay: `${formatEther(ethBalance)} ETH`,
    wethBalance: wethBalance.toString(),
    wethBalanceDisplay: `${formatUnits(wethBalance, 18)} WETH`,
    routerAllowance: routerAllowance.toString(),
    requiredRouterAllowance: AMOUNT_IN.toString(),
    balanceSufficient: wethBalance >= AMOUNT_IN,
    allowanceSufficient: routerAllowance >= AMOUNT_IN,
    exactCallSimulation: simulation,
  },
  oracleSafetyCheckV3: {
    expectedBinding: {
      subjectChainId: CHAIN_ID,
      action: 'swap',
      tradeAmountUsd: declaredAmountUsd,
      sourceAssetId: `eip155:${CHAIN_ID}/erc20:${WETH}`,
      destinationAssetId: `eip155:${CHAIN_ID}/erc20:${USDC}`,
    },
    sourceAssertion: {
      status: 'NOT_ISSUED',
      requiredVerdict: 'PASS',
      requiredSchemaVersion: 3,
      reason:
        'The local signer resolves to an expired registry key and audit persistence failed; no stale, sample, synthetic, or unsigned artifact is substituted.',
    },
    destinationAssertion: {
      status: 'NOT_ISSUED',
      requiredVerdict: 'PASS',
      requiredSchemaVersion: 3,
      reason:
        'The local signer resolves to an expired registry key and audit persistence failed; no stale, sample, synthetic, or unsigned artifact is substituted.',
    },
    issuanceProbe: {
      attemptedAt: '2026-09-23T06:30:26.948Z',
      localSignerAddress: '0xa268676C85b927D64a4e2384636874f76D69e419',
      localSignerRegistryValidUntil: '2026-09-02T17:35:36.000Z',
      activeProductionSignerAddress: '0x6506F789Edd43338A416f59822A63F309f97E8ce',
      auditPersistence: 'FAILED_CONNECTION_RESET',
      artifactRetainedOrUsed: false,
    },
  },
  trustRoots: {
    oracleKeys: {
      url: KEYS_URL,
      filename: 'oracle-keys.json',
      sha256: sha256(keysBytes),
      byteLength: keysBytes.length,
    },
    registryCurrent: {
      url: REGISTRY_CURRENT_URL,
      filename: 'oracle-registry-current.json',
      sha256: sha256(currentBytes),
      byteLength: currentBytes.length,
      releaseId: registryCurrent.releaseId,
    },
    immutableRegistryRelease: {
      url: releaseUrl,
      filename: `oracle-registry-release-${registryCurrent.releaseId}.json`,
      sha256: sha256(releaseBytes),
      byteLength: releaseBytes.length,
      releaseId: registryCurrent.releaseId,
    },
  },
  handoff: {
    hostReviewMayProceed: true,
    enableNativePrimaryGate: false,
    exchangeCredential: false,
    makeAuthenticatedPreflightCall: false,
    nextSafeStep:
      'Keep NO_RUN. Establish the separately scoped allowance outside this phase and restore access to the current production signer plus required audit persistence; then regenerate all volatile fields and both fresh PASS assertions.',
  },
};

const packageBytes = Buffer.from(json(packageDocument));
await writeBoth('candidate-run-package.json', packageBytes);

const markdown = `# InterAI Track 1 candidate non-broadcast package\n\n` +
  `Generated: ${packageDocument.generatedAtIso}\n\n` +
  `Disposition: **NO_RUN / INTERAI_EXECUTABLE_ALLOW_NOT_ESTABLISHED**\n\n` +
  `This is a binding-review snapshot, not an executable preflight input. No transaction was signed, no ERC-20 approval was made, no PriorSeal execution step ran, no Base Sepolia transaction was broadcast, no InterAI credential was exchanged, and no authenticated InterAI call was made.\n\n` +
  `## Candidate action\n\n` +
  `- Executor: \`${EXECUTOR}\` (public testnet development key; never production)\n` +
  `- Pending nonce: \`${pendingNonce}\`\n` +
  `- Target: \`${ROUTER}\`\n` +
  `- Value: \`0\`\n` +
  `- WETH amount in: \`${AMOUNT_IN}\` (${formatUnits(AMOUNT_IN, 18)} WETH)\n` +
  `- Fresh quote: \`${quotedAmountOut}\` (${formatUnits(quotedAmountOut, 6)} USDC)\n` +
  `- Quote observed / expires: \`${iso(generatedAt)}\` / \`${iso(quoteExpiresAt)}\`\n` +
  `- amountOutMinimum: \`${amountOutMinimum}\` (${formatUnits(amountOutMinimum, 6)} USDC)\n` +
  `- declared_amount_usd: \`${declaredAmountUsd}\`; currency: \`USD\`\n` +
  `- calldataHash: \`${calldataHash}\`\n` +
  `- Exact calldata: see \`candidate-run-package.json\`\n\n` +
  `## Fail-closed findings\n\n` +
  blockingReasons.map((reason) => `- \`${reason}\``).join('\n') +
  `\n\nRouter allowance is \`${routerAllowance}\`; required is \`${AMOUNT_IN}\`. The current production-signed source and destination OracleSafetyCheck v3 assertions are not present. A local probe found an expired local signer and failed required audit persistence, so no substitute assertion was included.\n\n` +
  `## Trust roots\n\n` +
  `The package includes the exact oracle key registry, current release pointer, and immutable release bytes. Their SHA-256 values and byte lengths are in \`candidate-run-package.json\` and \`SHA256SUMS.txt\`.\n`;
await writeBoth('README.md', Buffer.from(markdown));

const filesForSums = [
  ['README.md', Buffer.from(markdown)],
  ['candidate-run-package.json', packageBytes],
  ['oracle-keys.json', keysBytes],
  ['oracle-registry-current.json', currentBytes],
  [`oracle-registry-release-${registryCurrent.releaseId}.json`, releaseBytes],
];
const sums = `${filesForSums.map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join('\n')}\n`;
await writeBoth('SHA256SUMS.txt', Buffer.from(sums));

process.stdout.write(
  json({
    status: packageDocument.preflightDisposition,
    resultCode: packageDocument.executionAuthorization,
    packageId: packageDocument.packageId,
    quoteExpiresAt: packageDocument.quote.expiresAtIso,
    pendingNonce,
    calldataHash,
    blockingReasons,
    attachmentDir: ATTACHMENT_DIR,
    archiveDir: ARCHIVE_DIR,
  })
);
