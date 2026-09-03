import { normalizeExecution } from '../../core/execution.mjs';
import { SUPPORTED_CHAINS, getRpcUrls } from './chains.mjs';
import { RunProofError } from '../../core/errors.mjs';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const clean = (x) => x?.toLowerCase();
const address = (topic) => `0x${topic.slice(-40)}`.toLowerCase();
const hexBig = (x) => x == null ? null : BigInt(x).toString();
async function rpc(url, method, params, signal) { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal }); if (!response.ok) throw new Error(`HTTP_${response.status}`); const body = await response.json(); if (body.error) throw new Error(body.error.message || 'RPC_ERROR'); return body.result; }
export async function observeEvm({ chainId, txHash, confirmations = 0, rpcUrls, timeoutMs = 10000, signal }) {
  if (!SUPPORTED_CHAINS[chainId]) return normalizeExecution({ chainId, txHash, status: 'UNSUPPORTED_CHAIN', executionDataAvailable: false, observationSource: 'evm-json-rpc' });
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new RunProofError('INVALID_TX_HASH', 'txHash must be a 32-byte hex hash');
  const urls = rpcUrls ?? getRpcUrls(chainId); if (!urls?.length) throw new RunProofError('RPC_NOT_CONFIGURED', `Configure ${SUPPORTED_CHAINS[chainId].rpcEnv}; RunProof will not guess an endpoint`);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  let lastError; try { for (const url of urls) { try {
    const tx = await rpc(url, 'eth_getTransactionByHash', [txHash], controller.signal);
    if (!tx) return normalizeExecution({ chainId, txHash, status: 'NOT_FOUND', executionDataAvailable: false, observationSource: url });
    const receipt = await rpc(url, 'eth_getTransactionReceipt', [txHash], controller.signal);
    if (!receipt) return normalizeExecution({ chainId, txHash, status: 'PENDING', sender: tx.from, recipient: tx.to, nativeValue: hexBig(tx.value), executionDataAvailable: true, observationSource: url, finalityState: 'PENDING' });
    const block = await rpc(url, 'eth_blockNumber', [], controller.signal);
    const confirmationsSeen = Math.max(0, Number(BigInt(block) - BigInt(receipt.blockNumber)));
    const transfers = (receipt.logs ?? []).filter((log) => clean(log.topics?.[0]) === TRANSFER_TOPIC && log.topics.length >= 3).map((log) => ({ asset: log.address.toLowerCase(), sender: address(log.topics[1]), recipient: address(log.topics[2]), amount: hexBig(log.data), logIndex: Number(BigInt(log.logIndex)) }));
    const first = transfers[0];
    return normalizeExecution({ chainId, txHash, status: receipt.status === '0x0' ? 'REVERTED' : confirmationsSeen >= confirmations ? 'CONFIRMED' : 'PENDING', nonce: hexBig(tx.nonce), sender: tx.from, recipient: first?.recipient ?? tx.to, asset: first ? `eip155:${chainId}/erc20:${first.asset}` : `eip155:${chainId}/native`, amount: first?.amount ?? hexBig(tx.value), transfers, nativeValue: hexBig(tx.value), gasUsed: hexBig(receipt.gasUsed), fee: tx.gasPrice && receipt.gasUsed ? (BigInt(tx.gasPrice) * BigInt(receipt.gasUsed)).toString() : null, blockNumber: Number(BigInt(receipt.blockNumber)), blockHash: receipt.blockHash ?? null, confirmations: confirmationsSeen, observationSource: url, finalityState: confirmationsSeen >= confirmations ? 'CONFIRMED' : 'INSUFFICIENT_FINALITY' });
  } catch (error) { lastError = error; } } throw new RunProofError(controller.signal.aborted ? 'RPC_TIMEOUT' : 'RPC_FAILURE', lastError?.message || 'All RPC endpoints failed'); } finally { clearTimeout(timer); }
}
