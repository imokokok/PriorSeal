// Generated from record-transparency-anchor.mts by npm run core:build. Do not edit directly.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { decodeFunctionData, isAddress } from "viem";
import pg from "pg";
import { createPostgresStore } from "../src/infrastructure/persistence/postgres-store.mjs";
import { createRpcClient } from "../src/infrastructure/blockchain/evm/rpc-client.mjs";
import { getRpcUrls } from "../src/infrastructure/blockchain/evm/chains.mjs";
import { verifyTransparencyAnchor } from "../src/infrastructure/transparency/file-anchor-provider.mjs";
const chainId = Number(process.env.PRIORSEAL_ANCHOR_CHAIN_ID);
const contract = process.env.PRIORSEAL_ANCHOR_CONTRACT;
const txHash = process.env.PRIORSEAL_ANCHOR_TX_HASH;
const confirmations = Number(process.env.PRIORSEAL_ANCHOR_CONFIRMATIONS ?? 12);
if (!Number.isSafeInteger(chainId) || chainId < 1) throw new TypeError("PRIORSEAL_ANCHOR_CHAIN_ID must be configured");
if (!isAddress(contract ?? "")) throw new TypeError("PRIORSEAL_ANCHOR_CONTRACT must be configured");
if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) throw new TypeError("PRIORSEAL_ANCHOR_TX_HASH must be configured");
const contractAddress = contract;
const transactionHash = txHash;
if (!Number.isSafeInteger(confirmations) || confirmations < 1) throw new TypeError("PRIORSEAL_ANCHOR_CONFIRMATIONS must be a positive integer");
const rpcUrls = getRpcUrls(chainId) ?? [];
if (!rpcUrls.length) throw new TypeError("The anchor chain RPC must be configured");
const rpcClient = createRpcClient();
const connectionString = secureConnectionString(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
if (!connectionString) throw new TypeError("DATABASE_URL_UNPOOLED is required to match an anchor to the local log");
const pool = new pg.Pool({ connectionString });
let evidence;
try {
  for (const url of rpcUrls) {
    try {
      const reportedChainId = Number(BigInt(await rpcClient.call(url, "eth_chainId", [])));
      if (reportedChainId !== chainId) continue;
      const [transaction, receipt, head] = await Promise.all([rpcClient.call(url, "eth_getTransactionByHash", [transactionHash]), rpcClient.call(url, "eth_getTransactionReceipt", [transactionHash]), rpcClient.call(url, "eth_blockNumber", [])]);
      if (!transaction || !receipt || receipt.status !== "0x1" || String(transaction.to).toLowerCase() !== contractAddress.toLowerCase()) continue;
      const blockNumber = Number(BigInt(receipt.blockNumber));
      if (Number(BigInt(head) - BigInt(receipt.blockNumber) + 1n) < confirmations) throw new TypeError(`Anchor has fewer than ${confirmations} confirmations`);
      const block = await rpcClient.call(url, "eth_getBlockByNumber", [receipt.blockNumber, false]);
      if (!block) continue;
      const decoded = decodeFunctionData({ abi: anchorAbi(), data: transaction.input ?? transaction.data ?? "0x" });
      if (!decoded.args) continue;
      const size = Number(decoded.args[0]);
      const commitment = String(decoded.args[1]).slice(2).toLowerCase();
      const local = await pool.query("SELECT entry_hash FROM authorization_log WHERE sequence=$1", [size]);
      if (!local.rows[0]) continue;
      const headEntryHash = local.rows[0].entry_hash;
      const merkleRoot = (await createPostgresStore(pool).getAuthorizationMerkleSnapshot({ sequence: size, entryHash: headEntryHash }, size)).merkleRoot;
      if (commitment !== merkleRoot && commitment !== headEntryHash) continue;
      const candidate = { type: "eip155", chainId, contract: contractAddress.toLowerCase(), txHash: transactionHash.toLowerCase(), blockNumber, anchoredAt: Number(BigInt(block.timestamp)), size, headEntryHash, ...commitment === merkleRoot ? { merkleRoot } : {} };
      await verifyTransparencyAnchor(candidate, { rpcClient, rpcUrls: [url], minConfirmations: confirmations });
      evidence = candidate;
      break;
    } catch (error) {
      if (error instanceof Error && error.message.includes("fewer than")) throw error;
    }
  }
} finally {
  await pool.end();
}
if (!evidence) throw new TypeError("Anchor transaction could not be verified");
const output = resolve(process.env.PRIORSEAL_TRANSPARENCY_ANCHOR_FILE ?? ".priorseal/transparency-anchor.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}
`, { mode: 420 });
console.log(`Verified anchor record written to ${output}`);
function anchorAbi() {
  return [{ type: "function", name: "anchor", stateMutability: "nonpayable", inputs: [{ name: "size", type: "uint256" }, { name: "head", type: "bytes32" }], outputs: [] }];
}
function secureConnectionString(value) {
  if (!value) return value;
  const url = new URL(value);
  if (["prefer", "require", "verify-ca"].includes(url.searchParams.get("sslmode") ?? "")) url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
