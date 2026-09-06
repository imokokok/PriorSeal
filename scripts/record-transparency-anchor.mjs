import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { decodeFunctionData, isAddress } from 'viem';
import { createRpcClient } from '../src/infrastructure/blockchain/evm/rpc-client.mjs';
import { getRpcUrls } from '../src/infrastructure/blockchain/evm/chains.mjs';
import { verifyTransparencyAnchor } from '../src/infrastructure/transparency/file-anchor-provider.mjs';

const chainId = Number(process.env.PRIORSEAL_ANCHOR_CHAIN_ID);
const contract = process.env.PRIORSEAL_ANCHOR_CONTRACT;
const txHash = process.env.PRIORSEAL_ANCHOR_TX_HASH;
const confirmations = Number(process.env.PRIORSEAL_ANCHOR_CONFIRMATIONS ?? 12);
if (!Number.isSafeInteger(chainId) || chainId < 1) throw new TypeError('PRIORSEAL_ANCHOR_CHAIN_ID must be configured');
if (!isAddress(contract ?? '')) throw new TypeError('PRIORSEAL_ANCHOR_CONTRACT must be configured');
if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? '')) throw new TypeError('PRIORSEAL_ANCHOR_TX_HASH must be configured');
if (!Number.isSafeInteger(confirmations) || confirmations < 1) throw new TypeError('PRIORSEAL_ANCHOR_CONFIRMATIONS must be a positive integer');
const rpcUrls = getRpcUrls(chainId) ?? [];
if (!rpcUrls.length) throw new TypeError('The anchor chain RPC must be configured');

const rpcClient = createRpcClient();
let evidence;
for (const url of rpcUrls) {
  try {
    const reportedChainId = Number(BigInt(await rpcClient.call(url, 'eth_chainId', [])));
    if (reportedChainId !== chainId) continue;
    const [transaction, receipt, head] = await Promise.all([rpcClient.call(url, 'eth_getTransactionByHash', [txHash]), rpcClient.call(url, 'eth_getTransactionReceipt', [txHash]), rpcClient.call(url, 'eth_blockNumber', [])]);
    if (!transaction || !receipt || receipt.status !== '0x1' || String(transaction.to).toLowerCase() !== contract.toLowerCase()) continue;
    const blockNumber = Number(BigInt(receipt.blockNumber));
    if (Number(BigInt(head) - BigInt(receipt.blockNumber) + 1n) < confirmations) throw new TypeError(`Anchor has fewer than ${confirmations} confirmations`);
    const block = await rpcClient.call(url, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
    const decoded = decodeFunctionData({ abi: anchorAbi(), data: transaction.input ?? transaction.data });
    evidence = { type: 'eip155', chainId, contract: contract.toLowerCase(), txHash: txHash.toLowerCase(), blockNumber, anchoredAt: Number(BigInt(block.timestamp)), size: Number(decoded.args[0]), headEntryHash: String(decoded.args[1]).slice(2).toLowerCase() };
    await verifyTransparencyAnchor(evidence, { rpcClient, rpcUrls: [url] });
    break;
  } catch (error) {
    if (String(error.message).includes('fewer than')) throw error;
  }
}
if (!evidence) throw new TypeError('Anchor transaction could not be verified');
const output = resolve(process.env.PRIORSEAL_TRANSPARENCY_ANCHOR_FILE ?? '.priorseal/transparency-anchor.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
console.log(`Verified anchor record written to ${output}`);

function anchorAbi() { return [{ type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [{ name: 'size', type: 'uint256' }, { name: 'head', type: 'bytes32' }], outputs: [] }]; }
