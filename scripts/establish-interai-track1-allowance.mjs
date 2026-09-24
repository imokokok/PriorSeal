// Generated from establish-interai-track1-allowance.mts by npm run core:build. Do not edit directly.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  parseAbiItem
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
const CHAIN_ID = 84532;
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const PUBLIC_DEV_MNEMONIC = "test test test test test test test test test test test junk";
const EXECUTOR = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const WETH = "0x4200000000000000000000000000000000000006";
const EXACT_ALLOWANCE = 1000000000000000n;
const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "amount", type: "uint256" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "success", type: "bool" }]
  }
];
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function parseOutput(argv) {
  assert(
    argv.includes("--unsafe-public-dev-key"),
    "Refusing to sign without --unsafe-public-dev-key"
  );
  const outputIndex = argv.indexOf("--output");
  assert(outputIndex >= 0 && argv[outputIndex + 1], "--output is required");
  assert(argv.length === 3, "Usage: --unsafe-public-dev-key --output <file>");
  return path.resolve(argv[outputIndex + 1]);
}
function serialize(value) {
  return `${JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry, 2)}
`;
}
const output = parseOutput(process.argv.slice(2));
const account = mnemonicToAccount(PUBLIC_DEV_MNEMONIC, { addressIndex: 5 });
assert(
  account.address.toLowerCase() === EXECUTOR.toLowerCase(),
  "Unexpected public test account"
);
const transport = http(RPC_URL, { timeout: 3e4 });
const publicClient = createPublicClient({ chain: baseSepolia, transport });
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport
});
const [chainId, wethCode, ethBalance, wethBalance, allowanceBefore] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getCode({ address: WETH }),
  publicClient.getBalance({ address: EXECUTOR }),
  publicClient.readContract({
    address: WETH,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [EXECUTOR]
  }),
  publicClient.readContract({
    address: WETH,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [EXECUTOR, ROUTER]
  })
]);
assert(
  chainId === CHAIN_ID,
  `Expected Base Sepolia ${CHAIN_ID}, received ${chainId}`
);
assert(wethCode && wethCode !== "0x", "Pinned WETH contract is not deployed");
assert(ethBalance > 0n, "Executor has no Base Sepolia ETH for approval gas");
assert(
  wethBalance >= EXACT_ALLOWANCE,
  "Executor WETH balance is below the bounded allowance amount"
);
let transactionHash = null;
let receipt = null;
let verifiedAllowanceBefore = allowanceBefore;
if (allowanceBefore !== EXACT_ALLOWANCE) {
  const request = await publicClient.simulateContract({
    account,
    address: WETH,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [ROUTER, EXACT_ALLOWANCE]
  });
  transactionHash = await walletClient.writeContract(request.request);
  receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    confirmations: 1
  });
  assert(
    receipt.status === "success",
    `Allowance transaction ${transactionHash} reverted`
  );
} else {
  const latestBlock = await publicClient.getBlockNumber();
  const logs = await publicClient.getLogs({
    address: WETH,
    event: parseAbiItem(
      "event Approval(address indexed owner,address indexed spender,uint256 value)"
    ),
    args: { owner: EXECUTOR, spender: ROUTER },
    fromBlock: latestBlock - 999n,
    toBlock: latestBlock
  });
  const matching = logs.filter((log) => log.args.value === EXACT_ALLOWANCE).at(-1);
  assert(
    matching?.transactionHash && matching.blockNumber,
    "Exact allowance exists but its Approval log was not found"
  );
  transactionHash = matching.transactionHash;
  receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
  verifiedAllowanceBefore = await publicClient.readContract({
    address: WETH,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [EXECUTOR, ROUTER],
    blockNumber: matching.blockNumber - 1n
  });
}
const allowanceAfter = await publicClient.readContract({
  address: WETH,
  abi: ERC20_ABI,
  functionName: "allowance",
  args: [EXECUTOR, ROUTER],
  blockNumber: receipt?.blockNumber
});
assert(
  allowanceAfter === EXACT_ALLOWANCE,
  "Postcondition failed: allowance is not the exact bounded amount"
);
const receiptBlock = await publicClient.getBlock({
  blockNumber: receipt.blockNumber
});
const observedAt = new Date(
  Number(receiptBlock.timestamp) * 1e3
).toISOString();
const record = {
  schema: "interai.track1.separately-scoped-allowance-record.v1",
  status: "EXACT_ALLOWANCE_ESTABLISHED",
  observedAt,
  phase: "SEPARATE_PREREQUISITE_OUTSIDE_CANDIDATE_GENERATION",
  network: { name: "Base Sepolia", chainId: CHAIN_ID, rpc: RPC_URL },
  token: WETH,
  owner: EXECUTOR,
  spender: ROUTER,
  allowanceBefore: verifiedAllowanceBefore.toString(),
  allowanceAfter: allowanceAfter.toString(),
  boundedAmount: EXACT_ALLOWANCE.toString(),
  boundedAmountDisplay: `${formatUnits(EXACT_ALLOWANCE, 18)} WETH`,
  executorEthBalance: ethBalance.toString(),
  executorEthBalanceDisplay: `${formatEther(ethBalance)} ETH`,
  executorWethBalance: wethBalance.toString(),
  executorWethBalanceDisplay: `${formatUnits(wethBalance, 18)} WETH`,
  transaction: {
    hash: transactionHash,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber.toString(),
    transactionIndex: receipt.transactionIndex,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    status: receipt.status,
    confirmationsRequired: 1
  },
  boundaries: {
    unlimitedApproval: false,
    swapSigned: false,
    swapBroadcast: false,
    priorSealExecutionRun: false,
    interaiCredentialUsed: false,
    authenticatedInteraiPreflightCalled: false
  }
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, serialize(record), { flag: "wx", mode: 384 });
process.stdout.write(
  serialize({
    status: record.status,
    transactionHash,
    allowanceBefore: verifiedAllowanceBefore.toString(),
    allowanceAfter: allowanceAfter.toString(),
    output
  })
);
