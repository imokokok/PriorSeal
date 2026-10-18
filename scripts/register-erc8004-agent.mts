/**
 * Register PriorSeal as an ERC-8004 agent on BNB Chain's official Identity
 * Registry (EIP-8004 Trustless Agents).
 *
 * The on-chain identity token (agentId) points at
 * https://priorseal.xyz/.well-known/agent8004.json via `agentURI`, which binds
 * the ERC-8004 Identity Registry entry to PriorSeal's OpenAPI surface and x402
 * payment rails (Base + BNB Smart Chain, exact v2 USDC).
 *
 * Keys: uses ERC8004_REGISTRAR_PRIVATE_KEY from .env.local. This may be the
 * same registrar wallet as Insight's — the key OWNS the PriorSeal agentId NFT
 * and can update the registration later (URIUpdated / MetadataSet). Anyone
 * holding it controls PriorSeal's on-chain agent identity. Never put it in
 * git.
 *
 * Modes:
 *   --check                 Read-only: show registrar address, gas balance,
 *                           and (with --agent-id N) the on-chain registration.
 *   --network bscTestnet    Chain 97 drill (default).
 *   --network bsc           Chain 56 mainnet registration.
 *   --uri <url>             Override the agentURI (default: production file).
 *   --agent-id <n>          With --check: inspect an existing registration.
 *
 * Run:  npm run agent8004:register -- --check --network bsc
 *       npm run agent8004:register -- --network bscTestnet
 *       npm run agent8004:register -- --network bsc
 */
import { createPublicClient, createWalletClient, decodeEventLog, formatEther, http, parseEther } from 'viem'
import { bsc, bscTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const AGENT_URI_DEFAULT = 'https://priorseal.xyz/.well-known/agent8004.json'

const REGISTRY: Record<string, `0x${string}`> = {
  bsc: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  bscTestnet: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
}

const CHAINS = { bsc, bscTestnet } as const

// Minimal ABI: register + the views/events this script touches.
const IDENTITY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'getAgentWallet',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
    ],
  },
] as const

function parseArgs(argv: string[]) {
  const args: { check: boolean; network: 'bsc' | 'bscTestnet'; uri?: string; agentId?: bigint } = {
    check: false,
    network: 'bscTestnet',
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') args.check = true
    else if (argv[i] === '--network' && argv[i + 1]) {
      const network = argv[++i]
      if (network !== 'bsc' && network !== 'bscTestnet') throw new Error(`Unknown network: ${network}`)
      args.network = network
    } else if (argv[i] === '--uri' && argv[i + 1]) args.uri = argv[++i]
    else if (argv[i] === '--agent-id' && argv[i + 1]) args.agentId = BigInt(argv[++i])
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const chain = CHAINS[args.network]
  const registry = REGISTRY[args.network]
  const agentURI = args.uri ?? AGENT_URI_DEFAULT
  const client = createPublicClient({ chain, transport: http() })

  const header = `ERC-8004 Identity Registry · ${args.network} (chain ${chain.id})\nregistry  ${registry}\nagentURI  ${agentURI}`
  console.log(`\n${header}\n${'─'.repeat(header.split('\n')[0].length)}\n`)

  if (args.agentId !== undefined) {
    const [owner, uri, agentWallet] = await Promise.all([
      client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: 'ownerOf', args: [args.agentId] }),
      client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: 'tokenURI', args: [args.agentId] }),
      client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: 'getAgentWallet', args: [args.agentId] }).catch(() => undefined),
    ])
    console.log(`agentId     ${args.agentId}`)
    console.log(`owner       ${owner}`)
    console.log(`tokenURI    ${uri}`)
    if (agentWallet) console.log(`agentWallet ${agentWallet}`)
    return
  }

  const privateKey = process.env.ERC8004_REGISTRAR_PRIVATE_KEY
  const account = privateKey
    ? privateKeyToAccount(privateKey.startsWith('0x') ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`))
    : null

  console.log(`registrar  ${account ? account.address : '(no key — read-only)'}`)
  if (account) {
    const [balance, minted] = await Promise.all([
      client.getBalance({ address: account.address }),
      client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: 'balanceOf', args: [account.address] }),
    ])
    console.log(`gas balance ${formatEther(balance)} ${chain.nativeCurrency.symbol}`)
    console.log(`owned agents ${minted}`)
    if (args.check) return
    if (balance < parseEther('0.0005')) {
      throw new Error(`Insufficient gas for registration on ${args.network}. Fund ${account.address} first.`)
    }
  } else if (!args.check) {
    throw new Error('ERC8004_REGISTRAR_PRIVATE_KEY not set. Add it to .env.local or export it first.')
  }

  if (args.check) return

  const walletClient = createWalletClient({ chain, transport: http(), account: account! })
  console.log(`\n→ register("${agentURI}") ...`)
  const hash = await walletClient.writeContract({
    address: registry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [agentURI],
  })
  console.log(`  tx ${hash}`)
  const receipt = await client.waitForTransactionReceipt({ hash })
  console.log(`  status ${receipt.status} · block ${receipt.blockNumber} · gas ${receipt.gasUsed}`)

  let agentId: bigint | undefined
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({ abi: IDENTITY_REGISTRY_ABI, data: log.data, topics: log.topics, strict: false })
      if (event.eventName === 'Registered') {
        agentId = (event.args as { agentId: bigint }).agentId
        break
      }
    } catch {
      /* not one of our events */
    }
  }
  if (agentId === undefined) throw new Error('Registered event not found in receipt logs')

  const [uri, owner] = await Promise.all([
    client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: 'tokenURI', args: [agentId] }),
    client.readContract({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: 'ownerOf', args: [agentId] }),
  ])
  console.log(`\n✓ Registered agentId ${agentId}`)
  console.log(`  owner    ${owner}`)
  console.log(`  tokenURI ${uri}`)
  console.log(`\nNext: verify https://priorseal.xyz/.well-known/agent8004.json resolves, then record agentId ${agentId} (${args.network}) in the chain-capabilities doc and project memory.`)
  console.log('⚠ Back up ERC8004_REGISTRAR_PRIVATE_KEY — it owns this agentId and can update the registration.')
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
