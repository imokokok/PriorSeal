import { readFileSync } from 'node:fs';
import { decodeFunctionData } from 'viem';
import { assertOnlyFields, assertSafeJson } from '../../shared/safe-json.mjs';
import type { createRpcClient } from '../blockchain/evm/rpc-client.mjs';

export type TransparencyAnchor = { type: 'eip155'; chainId: number; contract: string; txHash: string; blockNumber: number; anchoredAt: number; size: number; headEntryHash: string; merkleRoot?: string };
type RpcTransaction = { hash: string; to: string; blockNumber: string; blockHash?: string; input?: string; data?: string };
type RpcReceipt = { status: string; transactionHash?: string; blockNumber: string; blockHash: string };
type RpcBlock = { hash: string; timestamp: string };

const ANCHOR_ABI = [{ type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [{ name: 'size', type: 'uint256' }, { name: 'head', type: 'bytes32' }], outputs: [] }];

export function readTransparencyAnchor(file: string | null | undefined) {
  if (!file) return null;
  return parseTransparencyAnchor(JSON.parse(readFileSync(file, 'utf8')));
}

export function parseTransparencyAnchor(input: unknown): TransparencyAnchor | null {
  if (input == null) return null;
  assertSafeJson(input);
  const anchor = assertOnlyFields(input, ['type', 'chainId', 'contract', 'txHash', 'blockNumber', 'anchoredAt', 'size', 'headEntryHash', 'merkleRoot'], 'transparency anchor');
  if (anchor.type !== 'eip155' || typeof anchor.chainId !== 'number' || !Number.isSafeInteger(anchor.chainId) || anchor.chainId < 1 || typeof anchor.contract !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(anchor.contract) || typeof anchor.txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(anchor.txHash) || typeof anchor.blockNumber !== 'number' || !Number.isSafeInteger(anchor.blockNumber) || anchor.blockNumber < 0 || typeof anchor.anchoredAt !== 'number' || !Number.isSafeInteger(anchor.anchoredAt) || anchor.anchoredAt < 0 || typeof anchor.size !== 'number' || !Number.isSafeInteger(anchor.size) || anchor.size < 1 || typeof anchor.headEntryHash !== 'string' || !/^[0-9a-f]{64}$/.test(anchor.headEntryHash) || (anchor.merkleRoot !== undefined && (typeof anchor.merkleRoot !== 'string' || !/^[0-9a-f]{64}$/.test(anchor.merkleRoot)))) throw new TypeError('Transparency anchor file is invalid');
  return { type: 'eip155', chainId: anchor.chainId, contract: anchor.contract.toLowerCase(), txHash: anchor.txHash.toLowerCase(), blockNumber: anchor.blockNumber, anchoredAt: anchor.anchoredAt, size: anchor.size, headEntryHash: anchor.headEntryHash, ...(anchor.merkleRoot !== undefined ? { merkleRoot: anchor.merkleRoot as string } : {}) };
}

export async function verifyTransparencyAnchor(anchor: TransparencyAnchor | null, { rpcClient, rpcUrls = [], minConfirmations = 1 }: { rpcClient: ReturnType<typeof createRpcClient>; rpcUrls?: string[]; minConfirmations?: number }) {
  if (!anchor) return null;
  if (!rpcClient?.call || !rpcUrls.length) throw new TypeError('Transparency anchor requires a configured RPC source for its chain');
  if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1 || minConfirmations > 10_000) throw new TypeError('Transparency anchor confirmations must be between 1 and 10000');
  for (const url of rpcUrls) {
    try {
      const reportedChainId = await rpcClient.call<string>(url, 'eth_chainId', []);
      if (Number(BigInt(reportedChainId)) !== anchor.chainId) continue;
      const [transaction, receipt, block, head] = await Promise.all([
        rpcClient.call<RpcTransaction | null>(url, 'eth_getTransactionByHash', [anchor.txHash]),
        rpcClient.call<RpcReceipt | null>(url, 'eth_getTransactionReceipt', [anchor.txHash]),
        rpcClient.call<RpcBlock | null>(url, 'eth_getBlockByNumber', [`0x${anchor.blockNumber.toString(16)}`, false]),
        rpcClient.call<string>(url, 'eth_blockNumber', []),
      ]);
      if (!transaction || !receipt || !block || String(receipt.status).toLowerCase() !== '0x1') continue;
      if (String(transaction.hash).toLowerCase() !== anchor.txHash || String(transaction.to).toLowerCase() !== anchor.contract) continue;
      if (receipt.transactionHash && String(receipt.transactionHash).toLowerCase() !== anchor.txHash) continue;
      if (hexNumber(transaction.blockNumber) !== anchor.blockNumber || hexNumber(receipt.blockNumber) !== anchor.blockNumber) continue;
      if (transaction.blockHash && String(transaction.blockHash).toLowerCase() !== String(receipt.blockHash).toLowerCase()) continue;
      if (String(receipt.blockHash).toLowerCase() !== String(block.hash).toLowerCase() || hexNumber(block.timestamp) !== anchor.anchoredAt) continue;
      const confirmations = BigInt(head) - BigInt(receipt.blockNumber) + 1n;
      if (confirmations < BigInt(minConfirmations)) continue;
      const decoded = decodeFunctionData({ abi: ANCHOR_ABI, data: (transaction.input ?? transaction.data) as `0x${string}` });
      if (decoded.functionName !== 'anchor' || !decoded.args || Number(decoded.args[0]) !== anchor.size || String(decoded.args[1]).slice(2).toLowerCase() !== (anchor.merkleRoot ?? anchor.headEntryHash)) continue;
      return anchor;
    } catch { /* Try the next explicitly configured source. */ }
  }
  throw new TypeError('Transparency anchor transaction could not be verified');
}

function hexNumber(value: unknown) {
  const parsed = Number.parseInt(String(value), 16);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}
