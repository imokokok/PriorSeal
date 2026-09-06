import { normalizeExecution } from '../../../domain/execution.mjs';
import { SUPPORTED_CHAINS, getRpcUrls } from './chains.mjs';
import { RunProofError } from '../../../domain/errors.mjs';
import { createRpcClient } from './rpc-client.mjs';
import { keccak256 } from 'viem';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TRANSFER_SELECTORS = ['0xa9059cbb', '0x23b872dd'];
const clean = (x) => x?.toLowerCase();
const address = (topic) => /^0x[0-9a-fA-F]{64}$/.test(topic ?? '') ? `0x${topic.slice(-40)}`.toLowerCase() : null;
const hexBig = (x) => x == null ? null : /^0x[0-9a-fA-F]+$/.test(x) ? BigInt(x).toString() : null;
const safeSource = (chainId, index) => `evm-json-rpc:eip155:${chainId}:configured-${index + 1}`;
const actionFor = (tx) => {
  const input = clean(tx.input ?? '0x');
  return input === '0x' || input === '0x0' || TRANSFER_SELECTORS.some((selector) => input.startsWith(selector)) ? 'TRANSFER' : 'CONTRACT_CALL';
};
export async function observeEvm({ chainId, txHash, confirmations = 0, rpcUrls, timeoutMs = 10000, signal, rpcClient = createRpcClient({ timeoutMs }) }) {
  if (!SUPPORTED_CHAINS[chainId]) return normalizeExecution({ chainId, txHash, status: 'UNSUPPORTED_CHAIN', executionDataAvailable: false, observationSource: 'evm-json-rpc' });
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new RunProofError('INVALID_TX_HASH', 'txHash must be a 32-byte hex hash');
  const urls = rpcUrls ?? getRpcUrls(chainId); if (!urls?.length) throw new RunProofError('RPC_NOT_CONFIGURED', `Configure ${SUPPORTED_CHAINS[chainId].rpcEnv}; RunProof will not guess an endpoint`);
  let lastError; for (const [index, url] of urls.entries()) { try {
    const observationSource = safeSource(chainId, index);
    const reportedChainId = await rpcClient.call(url, 'eth_chainId', [], signal); if (Number(BigInt(reportedChainId)) !== Number(chainId)) throw new RunProofError('RPC_CHAIN_MISMATCH', 'RPC endpoint reported an unexpected chain ID');
    const tx = await rpcClient.call(url, 'eth_getTransactionByHash', [txHash], signal);
    if (!tx) return normalizeExecution({ chainId, txHash, status: 'NOT_FOUND', executionDataAvailable: false, observationSource });
    if (String(tx.hash).toLowerCase() !== txHash.toLowerCase()) throw new RunProofError('RPC_INVALID_RESPONSE', 'Transaction hash does not match request');
    const receipt = await rpcClient.call(url, 'eth_getTransactionReceipt', [txHash], signal);
    if (!receipt) return normalizeExecution({ chainId, txHash, status: 'PENDING', action: actionFor(tx), sender: tx.from, recipient: tx.to, target: tx.to, calldataHash: keccak256(tx.input ?? '0x'), nativeValue: hexBig(tx.value), executionDataAvailable: true, observationSource, finalityState: 'PENDING' });
    const [head, containingBlock] = await Promise.all([
      rpcClient.call(url, 'eth_blockNumber', [], signal),
      rpcClient.call(url, 'eth_getBlockByHash', [receipt.blockHash, false], signal),
    ]);
    if (!containingBlock || clean(containingBlock.hash) !== clean(receipt.blockHash) || hexBig(containingBlock.timestamp) === null) throw new RunProofError('RPC_INVALID_RESPONSE', 'RPC endpoint returned inconsistent block evidence');
    const confirmationsSeen = Math.max(0, Number(BigInt(head) - BigInt(receipt.blockNumber) + 1n));
    const transfers = (receipt.logs ?? []).filter((log) => clean(log.topics?.[0]) === TRANSFER_TOPIC && log.topics.length === 3 && /^0x[0-9a-fA-F]{40}$/.test(log.address ?? '') && address(log.topics[1]) && address(log.topics[2]) && hexBig(log.data) !== null && hexBig(log.logIndex) !== null).map((log) => ({ asset: log.address.toLowerCase(), sender: address(log.topics[1]), recipient: address(log.topics[2]), amount: hexBig(log.data), logIndex: Number(BigInt(log.logIndex)) }));
    const first = transfers[0];
    const gasPrice = receipt.effectiveGasPrice ?? tx.gasPrice;
    return normalizeExecution({ chainId, txHash, status: receipt.status === '0x0' ? 'REVERTED' : confirmationsSeen >= confirmations ? 'CONFIRMED' : 'PENDING', executedAt: Number(BigInt(containingBlock.timestamp)), action: actionFor(tx), nonce: hexBig(tx.nonce), sender: tx.from, recipient: first?.recipient ?? tx.to, target: tx.to, calldataHash: keccak256(tx.input ?? '0x'), asset: first ? `eip155:${chainId}/erc20:${first.asset}` : `eip155:${chainId}/native`, amount: first?.amount ?? hexBig(tx.value), transfers, nativeValue: hexBig(tx.value), gasUsed: hexBig(receipt.gasUsed), fee: gasPrice && receipt.gasUsed ? (BigInt(gasPrice) * BigInt(receipt.gasUsed)).toString() : null, blockNumber: Number(BigInt(receipt.blockNumber)), blockHash: receipt.blockHash ?? null, confirmations: confirmationsSeen, observationSource, finalityState: confirmationsSeen >= confirmations ? 'CONFIRMED' : 'INSUFFICIENT_FINALITY' });
  } catch (error) { lastError = error; } }
  throw new RunProofError(signal?.aborted ? 'REQUEST_ABORTED' : lastError?.code === 'RPC_TIMEOUT' ? 'RPC_TIMEOUT' : 'RPC_FAILURE', 'All RPC endpoints failed');
}
