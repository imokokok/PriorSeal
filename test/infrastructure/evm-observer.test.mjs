import test from 'node:test';
import assert from 'node:assert/strict';
import { observeEvm } from '../../src/infrastructure/blockchain/evm/observer.mjs';

const txHash = `0x${'1'.repeat(64)}`;
const sender = `0x${'a'.repeat(40)}`;
const recipient = `0x${'b'.repeat(40)}`;
test('EVM observer validates endpoint chain identity and falls back safely', async () => {
  const calls = []; const rpcClient = { async call(url, method) { calls.push([url, method]); if (url === 'bad') return '0x1'; if (method === 'eth_chainId') return '0x2105'; if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x1', value: '0x0', input: '0x', gasPrice: '0x2' }; if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0xa', blockHash: `0x${'c'.repeat(64)}`, gasUsed: '0x5208', effectiveGasPrice: '0x3', logs: [] }; if (method === 'eth_blockNumber') return '0xa'; if (method === 'eth_getBlockByHash') return { hash: `0x${'c'.repeat(64)}`, timestamp: '0x64' }; throw new Error('unexpected method'); } };
  const observation = await observeEvm({ chainId: 8453, txHash, confirmations: 1, rpcUrls: ['bad', 'good'], rpcClient });
  assert.equal(observation.status, 'CONFIRMED'); assert.equal(observation.confirmations, 1); assert.equal(observation.fee, '63000'); assert.equal(observation.executedAt, 100); assert.equal(observation.action, 'TRANSFER'); assert.equal(observation.observationSource, 'evm-json-rpc:eip155:8453:configured-2'); assert.equal(JSON.stringify(observation).includes('good'), false); assert.deepEqual(calls.slice(0, 2), [['bad', 'eth_chainId'], ['good', 'eth_chainId']]);
});
test('EVM observer rejects unsafe confirmation thresholds', async () => {
  await assert.rejects(() => observeEvm({ chainId: 8453, txHash, confirmations: -1, rpcUrls: ['unused'] }), (error) => error.code === 'INVALID_REQUEST');
});
test('EVM observer does not treat malformed transfer logs as verified transfers', async () => {
  const rpcClient = { async call(_url, method) { if (method === 'eth_chainId') return '0x2105'; if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x0', value: '0x1', input: '0x12345678' }; if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0xa', blockHash: `0x${'c'.repeat(64)}`, gasUsed: '0x1', logs: [{ topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', 'bad'], address: 'bad', data: 'bad', logIndex: 'bad' }] }; if (method === 'eth_getBlockByHash') return { hash: `0x${'c'.repeat(64)}`, timestamp: '0x64' }; return '0xa'; } };
  const observation = await observeEvm({ chainId: 8453, txHash, rpcUrls: ['https://secret.invalid/api-key'], rpcClient }); assert.equal(observation.transfers.length, 0); assert.equal(observation.asset, 'eip155:8453/native'); assert.equal(observation.action, 'CONTRACT_CALL'); assert.equal(JSON.stringify(observation).includes('api-key'), false);
});

test('EVM observer prefers stronger fallback evidence and preserves pending nonce', async () => {
  const rpcClient = { async call(url, method) {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return url === 'stale' ? null : { hash: txHash, from: sender, to: recipient, nonce: '0x7', value: '0x0', input: '0x' };
    if (method === 'eth_getTransactionReceipt') return null;
    throw new Error('unexpected method');
  } };
  const observation = await observeEvm({ chainId: 8453, txHash, rpcUrls: ['stale', 'current'], rpcClient });
  assert.equal(observation.status, 'PENDING');
  assert.equal(observation.nonce, '7');
  assert.equal(observation.observationSource, 'evm-json-rpc:eip155:8453:configured-2');
});
