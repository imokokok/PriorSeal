// Generated from register-erc8004-agent.mts by npm run core:build. Do not edit directly.
import { createPublicClient, createWalletClient, decodeEventLog, formatEther, http, parseEther } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
const AGENT_URI_DEFAULT = "https://priorseal.xyz/.well-known/agent8004.json";
const REGISTRY = {
  bsc: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  bscTestnet: "0x8004A818BFB912233c491871b3d84c89A494BD9e"
};
const CHAINS = { bsc, bscTestnet };
const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }]
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: false }
    ]
  }
];
function parseArgs(argv) {
  const args = {
    check: false,
    network: "bscTestnet"
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") args.check = true;
    else if (argv[i] === "--network" && argv[i + 1]) {
      const network = argv[++i];
      if (network !== "bsc" && network !== "bscTestnet") throw new Error(`Unknown network: ${network}`);
      args.network = network;
    } else if (argv[i] === "--uri" && argv[i + 1]) args.uri = argv[++i];
    else if (argv[i] === "--agent-id" && argv[i + 1]) args.agentId = BigInt(argv[++i]);
  }
  return args;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chain = CHAINS[args.network];
  const registry = REGISTRY[args.network];
  const agentURI = args.uri ?? AGENT_URI_DEFAULT;
  const client = createPublicClient({ chain, transport: http() });
  const header = `ERC-8004 Identity Registry \xB7 ${args.network} (chain ${chain.id})
registry  ${registry}
agentURI  ${agentURI}`;
  console.log(`
${header}
${"\u2500".repeat(header.split("\n")[0].length)}
`);
  if (args.agentId !== void 0) {
    const [owner2, uri2, agentWallet] = await Promise.all([
      client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [args.agentId] }),
      client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [args.agentId] }),
      client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "getAgentWallet", args: [args.agentId] }).catch(() => void 0)
    ]);
    console.log(`agentId     ${args.agentId}`);
    console.log(`owner       ${owner2}`);
    console.log(`tokenURI    ${uri2}`);
    if (agentWallet) console.log(`agentWallet ${agentWallet}`);
    return;
  }
  const privateKey = process.env.ERC8004_REGISTRAR_PRIVATE_KEY;
  const account = privateKey ? privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) : null;
  console.log(`registrar  ${account ? account.address : "(no key \u2014 read-only)"}`);
  if (account) {
    const [balance, minted] = await Promise.all([
      client.getBalance({ address: account.address }),
      client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "balanceOf", args: [account.address] })
    ]);
    console.log(`gas balance ${formatEther(balance)} ${chain.nativeCurrency.symbol}`);
    console.log(`owned agents ${minted}`);
    if (args.check) return;
    if (balance < parseEther("0.0005")) {
      throw new Error(`Insufficient gas for registration on ${args.network}. Fund ${account.address} first.`);
    }
  } else if (!args.check) {
    throw new Error("ERC8004_REGISTRAR_PRIVATE_KEY not set. Add it to .env.local or export it first.");
  }
  if (args.check) return;
  const walletClient = createWalletClient({ chain, transport: http(), account });
  console.log(`
\u2192 register("${agentURI}") ...`);
  const hash = await walletClient.writeContract({
    address: registry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [agentURI]
  });
  console.log(`  tx ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`  status ${receipt.status} \xB7 block ${receipt.blockNumber} \xB7 gas ${receipt.gasUsed}`);
  let agentId;
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({ abi: IDENTITY_REGISTRY_ABI, data: log.data, topics: log.topics, strict: false });
      if (event.eventName === "Registered") {
        agentId = event.args.agentId;
        break;
      }
    } catch {
    }
  }
  if (agentId === void 0) throw new Error("Registered event not found in receipt logs");
  const [uri, owner] = await Promise.all([
    client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [agentId] }),
    client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [agentId] })
  ]);
  console.log(`
\u2713 Registered agentId ${agentId}`);
  console.log(`  owner    ${owner}`);
  console.log(`  tokenURI ${uri}`);
  console.log(`
Next: verify https://priorseal.xyz/.well-known/agent8004.json resolves, then record agentId ${agentId} (${args.network}) in the chain-capabilities doc and project memory.`);
  console.log("\u26A0 Back up ERC8004_REGISTRAR_PRIVATE_KEY \u2014 it owns this agentId and can update the registration.");
}
main().catch((error) => {
  console.error(`
\u2717 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
