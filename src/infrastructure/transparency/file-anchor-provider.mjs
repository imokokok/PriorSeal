import { readFileSync } from 'node:fs';
import { decodeFunctionData } from 'viem';
import { assertOnlyFields, assertSafeJson } from '../../shared/safe-json.mjs';

const ANCHOR_ABI = [{ type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [{ name: 'size', type: 'uint256' }, { name: 'head', type: 'bytes32' }], outputs: [] }];

export function readTransparencyAnchor(file) {
  if (!file) return null;
  return parseTransparencyAnchor(JSON.parse(readFileSync(file, 'utf8')));
}

export function parseTransparencyAnchor(anchor) {
  if (anchor == null) return null;
  assertSafeJson(anchor);
  assertOnlyFields(anchor, ['type', 'chainId', 'contract', 'txHash', 'blockNumber', 'anchoredAt', 'size', 'headEntryHash'], 'transparency anchor');
  if (anchor.type !== 'eip155' || !Number.isSafeInteger(anchor.chainId) || !/^0x[0-9a-fA-F]{40}$/.test(anchor.contract) || !/^0x[0-9a-fA-F]{64}$/.test(anchor.txHash) || !Number.isSafeInteger(anchor.blockNumber) || !Number.isSafeInteger(anchor.anchoredAt) || !Number.isSafeInteger(anchor.size) || !/^[0-9a-f]{64}$/.test(anchor.headEntryHash)) throw new TypeError('Transparency anchor file is invalid');
  return { ...anchor, contract: anchor.contract.toLowerCase(), txHash: anchor.txHash.toLowerCase() };
}

export async function verifyTransparencyAnchor(anchor, { rpcClient, rpcUrls = [] } = {}) {
  if (!anchor) return null;
  if (!rpcClient?.call || !rpcUrls.length) throw new TypeError('Transparency anchor requires a configured RPC source for its chain');
  for (const url of rpcUrls) {
    try {
      const [transaction, receipt, block] = await Promise.all([
        rpcClient.call(url, 'eth_getTransactionByHash', [anchor.txHash]),
        rpcClient.call(url, 'eth_getTransactionReceipt', [anchor.txHash]),
        rpcClient.call(url, 'eth_getBlockByNumber', [`0x${anchor.blockNumber.toString(16)}`, false]),
      ]);
      if (!transaction || !receipt || !block || String(receipt.status).toLowerCase() !== '0x1') continue;
      if (String(transaction.hash).toLowerCase() !== anchor.txHash || String(transaction.to).toLowerCase() !== anchor.contract) continue;
      if (hexNumber(transaction.blockNumber) !== anchor.blockNumber || hexNumber(receipt.blockNumber) !== anchor.blockNumber) continue;
      if (String(receipt.blockHash).toLowerCase() !== String(block.hash).toLowerCase() || hexNumber(block.timestamp) !== anchor.anchoredAt) continue;
      const decoded = decodeFunctionData({ abi: ANCHOR_ABI, data: transaction.input ?? transaction.data });
      if (decoded.functionName !== 'anchor' || Number(decoded.args[0]) !== anchor.size || String(decoded.args[1]).slice(2).toLowerCase() !== anchor.headEntryHash) continue;
      return anchor;
    } catch { /* Try the next explicitly configured source. */ }
  }
  throw new TypeError('Transparency anchor transaction could not be verified');
}

function hexNumber(value) {
  const parsed = Number.parseInt(String(value), 16);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}
