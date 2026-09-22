// Generated from file-anchor-provider.mts by npm run core:build. Do not edit directly.
import { readFileSync } from "node:fs";
import { decodeFunctionData } from "viem";
import { assertOnlyFields, assertSafeJson } from "../../shared/safe-json.mjs";
const ANCHOR_ABI = [{ type: "function", name: "anchor", stateMutability: "nonpayable", inputs: [{ name: "size", type: "uint256" }, { name: "head", type: "bytes32" }], outputs: [] }];
function readTransparencyAnchor(file) {
  if (!file) return null;
  return parseTransparencyAnchor(JSON.parse(readFileSync(file, "utf8")));
}
function parseTransparencyAnchor(input) {
  if (input == null) return null;
  assertSafeJson(input);
  const anchor = assertOnlyFields(input, ["type", "chainId", "contract", "txHash", "blockNumber", "anchoredAt", "size", "headEntryHash", "merkleRoot"], "transparency anchor");
  if (anchor.type !== "eip155" || typeof anchor.chainId !== "number" || !Number.isSafeInteger(anchor.chainId) || anchor.chainId < 1 || typeof anchor.contract !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(anchor.contract) || typeof anchor.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(anchor.txHash) || typeof anchor.blockNumber !== "number" || !Number.isSafeInteger(anchor.blockNumber) || anchor.blockNumber < 0 || typeof anchor.anchoredAt !== "number" || !Number.isSafeInteger(anchor.anchoredAt) || anchor.anchoredAt < 0 || typeof anchor.size !== "number" || !Number.isSafeInteger(anchor.size) || anchor.size < 1 || typeof anchor.headEntryHash !== "string" || !/^[0-9a-f]{64}$/.test(anchor.headEntryHash) || anchor.merkleRoot !== void 0 && (typeof anchor.merkleRoot !== "string" || !/^[0-9a-f]{64}$/.test(anchor.merkleRoot))) throw new TypeError("Transparency anchor file is invalid");
  return { type: "eip155", chainId: anchor.chainId, contract: anchor.contract.toLowerCase(), txHash: anchor.txHash.toLowerCase(), blockNumber: anchor.blockNumber, anchoredAt: anchor.anchoredAt, size: anchor.size, headEntryHash: anchor.headEntryHash, ...anchor.merkleRoot !== void 0 ? { merkleRoot: anchor.merkleRoot } : {} };
}
async function verifyTransparencyAnchor(anchor, { rpcClient, rpcUrls = [], minConfirmations = 1 }) {
  if (!anchor) return null;
  if (!rpcClient?.call || !rpcUrls.length) throw new TypeError("Transparency anchor requires a configured RPC source for its chain");
  if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1 || minConfirmations > 1e4) throw new TypeError("Transparency anchor confirmations must be between 1 and 10000");
  for (const url of rpcUrls) {
    try {
      const reportedChainId = await rpcClient.call(url, "eth_chainId", []);
      if (Number(BigInt(reportedChainId)) !== anchor.chainId) continue;
      const [transaction, receipt, block, head] = await Promise.all([
        rpcClient.call(url, "eth_getTransactionByHash", [anchor.txHash]),
        rpcClient.call(url, "eth_getTransactionReceipt", [anchor.txHash]),
        rpcClient.call(url, "eth_getBlockByNumber", [`0x${anchor.blockNumber.toString(16)}`, false]),
        rpcClient.call(url, "eth_blockNumber", [])
      ]);
      if (!transaction || !receipt || !block || String(receipt.status).toLowerCase() !== "0x1") continue;
      if (String(transaction.hash).toLowerCase() !== anchor.txHash || String(transaction.to).toLowerCase() !== anchor.contract) continue;
      if (receipt.transactionHash && String(receipt.transactionHash).toLowerCase() !== anchor.txHash) continue;
      if (hexNumber(transaction.blockNumber) !== anchor.blockNumber || hexNumber(receipt.blockNumber) !== anchor.blockNumber) continue;
      if (transaction.blockHash && String(transaction.blockHash).toLowerCase() !== String(receipt.blockHash).toLowerCase()) continue;
      if (String(receipt.blockHash).toLowerCase() !== String(block.hash).toLowerCase() || hexNumber(block.timestamp) !== anchor.anchoredAt) continue;
      const confirmations = BigInt(head) - BigInt(receipt.blockNumber) + 1n;
      if (confirmations < BigInt(minConfirmations)) continue;
      const decoded = decodeFunctionData({ abi: ANCHOR_ABI, data: transaction.input ?? transaction.data });
      if (decoded.functionName !== "anchor" || !decoded.args || Number(decoded.args[0]) !== anchor.size || String(decoded.args[1]).slice(2).toLowerCase() !== (anchor.merkleRoot ?? anchor.headEntryHash)) continue;
      return anchor;
    } catch {
    }
  }
  throw new TypeError("Transparency anchor transaction could not be verified");
}
function hexNumber(value) {
  const parsed = Number.parseInt(String(value), 16);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}
export {
  parseTransparencyAnchor,
  readTransparencyAnchor,
  verifyTransparencyAnchor
};
