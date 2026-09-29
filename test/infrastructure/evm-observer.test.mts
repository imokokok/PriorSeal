import test from 'node:test';
import assert from 'node:assert/strict';
import { observeEvm } from '../../src/infrastructure/blockchain/evm/observer.mjs';
import { getRpcUrls, SUPPORTED_CHAINS } from '../../src/infrastructure/blockchain/evm/chains.mjs';

const txHash = `0x${'1'.repeat(64)}`;
const sender = `0x${'a'.repeat(40)}`;
const recipient = `0x${'b'.repeat(40)}`;
const blockHash = `0x${'c'.repeat(64)}`;
type ObserverRpcClient = NonNullable<Parameters<typeof observeEvm>[0]['rpcClient']>;
const mockRpcClient = (handler: (url: string, method: string, params: unknown[]) => unknown | Promise<unknown>): ObserverRpcClient => ({
  async call<T>(url: string, method: string, params: unknown[]): Promise<T> {
    return await handler(url, method, params) as T;
  },
});
const hasCode = (error: unknown, code: string) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;

test('Base Sepolia is an explicit optional observation network', () => {
  assert.equal(SUPPORTED_CHAINS[84532].name, 'Base Sepolia');
  assert.deepEqual(getRpcUrls(84532, { PRIORSEAL_RPC_BASE_SEPOLIA: 'https://one.invalid, https://two.invalid' }), ['https://one.invalid', 'https://two.invalid']);
  assert.deepEqual(getRpcUrls(84532, {}), []);
});
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const addressTopic = (value: string) => `0x${'0'.repeat(24)}${value.slice(2)}`;
test('EVM observer validates endpoint chain identity and falls back safely', async () => {
  const calls: Array<[string, string]> = []; const rpcClient = mockRpcClient(async (url, method) => { calls.push([url, method]); if (url === 'bad') return '0x1'; if (method === 'eth_chainId') return '0x2105'; if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x1', value: '0x0', input: '0x', gasPrice: '0x2' }; if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0xa', blockHash: `0x${'c'.repeat(64)}`, gasUsed: '0x5208', effectiveGasPrice: '0x3', logs: [] }; if (method === 'eth_blockNumber') return '0xa'; if (method === 'eth_getBlockByHash') return { hash: `0x${'c'.repeat(64)}`, timestamp: '0x64' }; throw new Error('unexpected method'); });
  const observation = await observeEvm({ chainId: 8453, txHash, confirmations: 1, rpcUrls: ['bad', 'good'], rpcClient });
  assert.equal(observation.status, 'CONFIRMED'); assert.equal(observation.confirmations, 1); assert.equal(observation.fee, '63000'); assert.equal(observation.executedAt, 100); assert.equal(observation.action, 'TRANSFER'); assert.equal(observation.observationSource, 'evm-json-rpc:eip155:8453:configured-2'); assert.equal(JSON.stringify(observation).includes('good'), false); assert.deepEqual(calls.slice(0, 2), [['bad', 'eth_chainId'], ['good', 'eth_chainId']]);
});
test('EVM observer rejects unsafe confirmation thresholds', async () => {
  await assert.rejects(() => observeEvm({ chainId: 8453, txHash, confirmations: -1, rpcUrls: ['unused'] }), (error) => hasCode(error, 'INVALID_REQUEST'));
});
test('EVM observer rejects missing nonce and gas evidence from RPC responses', async () => {
  const missingNonceClient = mockRpcClient(async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, value: '0x0', input: '0x' };
    throw new Error('unexpected method');
  });
  await assert.rejects(() => observeEvm({ chainId: 8453, txHash, rpcUrls: ['rpc'], rpcClient: missingNonceClient }), (error) => hasCode(error, 'RPC_FAILURE'));

  const missingGasClient = mockRpcClient(async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x1', value: '0x0', input: '0x' };
    if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0xa', blockHash, logs: [] };
    throw new Error('unexpected method');
  });
  await assert.rejects(() => observeEvm({ chainId: 8453, txHash, rpcUrls: ['rpc'], rpcClient: missingGasClient }), (error) => hasCode(error, 'RPC_FAILURE'));
});
test('EVM observer does not treat malformed transfer logs as verified transfers', async () => {
  const rpcClient = mockRpcClient(async (_url, method) => { if (method === 'eth_chainId') return '0x2105'; if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x0', value: '0x1', input: '0x12345678' }; if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0xa', blockHash: `0x${'c'.repeat(64)}`, gasUsed: '0x1', logs: [{ topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', 'bad'], address: 'bad', data: 'bad', logIndex: 'bad' }] }; if (method === 'eth_getBlockByHash') return { hash: `0x${'c'.repeat(64)}`, timestamp: '0x64' }; return '0xa'; });
  const observation = await observeEvm({ chainId: 8453, txHash, rpcUrls: ['https://secret.invalid/api-key'], rpcClient }); assert.equal(observation.transfers.length, 0); assert.equal(observation.asset, 'eip155:8453/native'); assert.equal(observation.action, 'CONTRACT_CALL'); assert.equal(JSON.stringify(observation).includes('api-key'), false);
});

test('EVM observer preserves verified transfer order while ignoring other logs', async () => {
  const token = `0x${'d'.repeat(40)}`;
  const transfer = (to: string, amount: string, index: string) => ({ transactionHash: txHash, blockHash, address: token, topics: [transferTopic, addressTopic(sender), addressTopic(to)], data: `0x${amount.padStart(64, '0')}`, logIndex: index });
  const rpcClient = mockRpcClient(async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x0', value: '0x0', input: '0xa9059cbb', blockNumber: '0xa', blockHash };
    if (method === 'eth_getTransactionReceipt') return { transactionHash: txHash, status: '0x1', blockNumber: '0xa', blockHash, gasUsed: '0x1', logs: [transfer(recipient, '2', '0x0'), { transactionHash: txHash, blockHash, topics: [], address: token, data: '0x', logIndex: '0x1' }, transfer(sender, '3', '0x2')] };
    if (method === 'eth_blockNumber') return '0xa';
    if (method === 'eth_getBlockByHash') return { number: '0xa', hash: blockHash, timestamp: '0x64' };
    throw new Error('unexpected method');
  });
  const observation = await observeEvm({ chainId: 8453, txHash, rpcUrls: ['rpc'], rpcClient });
  assert.deepEqual(observation.transfers, [
    { asset: token, sender, recipient, amount: '2', logIndex: 0 },
    { asset: token, sender, recipient: sender, amount: '3', logIndex: 2 },
  ]);
  assert.equal(observation.asset, `eip155:8453/erc20:${token}`);
  assert.equal(observation.recipient, recipient);
});

test('EVM observer prefers stronger fallback evidence and preserves pending nonce', async () => {
  const rpcClient = mockRpcClient(async (url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return url === 'stale' ? null : { hash: txHash, from: sender, to: recipient, nonce: '0x7', value: '0x0', input: '0x' };
    if (method === 'eth_getTransactionReceipt') return null;
    throw new Error('unexpected method');
  });
  const observation = await observeEvm({ chainId: 8453, txHash, rpcUrls: ['stale', 'current'], rpcClient });
  assert.equal(observation.status, 'PENDING');
  assert.equal(observation.nonce, '7');
  assert.equal(observation.observationSource, 'evm-json-rpc:eip155:8453:configured-2');
});

test('under-finalized reverted receipts remain pending until the confirmation floor', async () => {
  let head = '0xa';
  const rpcClient = mockRpcClient(async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x4', value: '0x0', input: '0x', blockNumber: '0xa', blockHash };
    if (method === 'eth_getTransactionReceipt') return { transactionHash: txHash, status: '0x0', blockNumber: '0xa', blockHash, gasUsed: '0x5208', logs: [] };
    if (method === 'eth_blockNumber') return head;
    if (method === 'eth_getBlockByHash') return { number: '0xa', hash: blockHash, timestamp: '0x64' };
    throw new Error('unexpected method');
  });
  const pending = await observeEvm({ chainId: 8453, txHash, confirmations: 12, rpcUrls: ['rpc'], rpcClient });
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.finalityState, 'INSUFFICIENT_FINALITY');
  head = '0x15';
  const final = await observeEvm({ chainId: 8453, txHash, confirmations: 12, rpcUrls: ['rpc'], rpcClient });
  assert.equal(final.status, 'REVERTED');
  assert.equal(final.finalityState, 'CONFIRMED');
});

test('RPC finalized requirement freezes the finalized checkpoint and never promotes depth alone', async () => {
  let finalizedHeight = 9;
  let finalizedCanonical = true;
  const rpcClient = mockRpcClient(async (_url, method, params) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x4', value: '0x0', input: '0x', blockNumber: '0xa', blockHash };
    if (method === 'eth_getTransactionReceipt') return { transactionHash: txHash, status: '0x1', blockNumber: '0xa', blockHash, gasUsed: '0x5208', logs: [] };
    if (method === 'eth_blockNumber') return '0xc';
    if (method === 'eth_getBlockByHash') return { number: '0xa', hash: blockHash, timestamp: '0x64' };
    if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') return { number: `0x${finalizedHeight.toString(16)}`, hash: finalizedHeight === 10 ? blockHash : `0x${'d'.repeat(64)}`, timestamp: '0x64' };
    if (method === 'eth_getBlockByNumber' && params[0] === '0xc') return { number: '0xc', hash: `0x${'e'.repeat(64)}`, timestamp: '0x64' };
    if (method === 'eth_getBlockByNumber' && params[0] === '0xa') return { number: '0xa', hash: blockHash, timestamp: '0x64' };
    if (method === 'eth_getBlockByNumber' && params[0] === '0x9') return { number: '0x9', hash: `0x${(finalizedCanonical ? 'd' : 'f').repeat(64)}`, timestamp: '0x64' };
    throw new Error('unexpected method');
  });
  const input = { chainId: 8453, txHash, confirmations: 1, finalityRequirement: 'RPC_FINALIZED' as const, maxToleratedReorgDepth: 2, rpcUrls: ['rpc'], rpcClient };
  const pending = await observeEvm(input);
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.finalityState, 'INSUFFICIENT_FINALITY');
  assert.equal(pending.temporalEvidence?.requiredConfirmations, 3);
  assert.equal(pending.temporalEvidence?.finalizedBlock?.number, 9);
  finalizedHeight = 10;
  const final = await observeEvm(input);
  assert.equal(final.status, 'CONFIRMED');
  assert.equal(final.finalityState, 'FINALIZED');
  assert.equal(final.temporalEvidence?.observedHeadNumber, 12);
  assert.equal(final.temporalEvidence?.observedHeadHash, `0x${'e'.repeat(64)}`);
  assert.equal(final.temporalEvidence?.finalizedBlock?.number, 10);
  finalizedHeight = 9;
  finalizedCanonical = false;
  await assert.rejects(() => observeEvm(input), (error) => hasCode(error, 'RPC_FAILURE'));
});

test('RPC finalized requirement rejects a noncanonical inclusion and stays pending when finalized is unavailable', async () => {
  let canonicalHash = `0x${'d'.repeat(64)}`;
  let finalizedAvailable = true;
  const rpcClient = mockRpcClient(async (_url, method, params) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x4', value: '0x0', input: '0x', blockNumber: '0xa', blockHash };
    if (method === 'eth_getTransactionReceipt') return { transactionHash: txHash, status: '0x1', blockNumber: '0xa', blockHash, gasUsed: '0x5208', logs: [] };
    if (method === 'eth_blockNumber') return '0xc';
    if (method === 'eth_getBlockByHash') return { number: '0xa', hash: blockHash, timestamp: '0x64' };
    if (method === 'eth_getBlockByNumber' && params[0] === '0xa') return { number: '0xa', hash: canonicalHash, timestamp: '0x64' };
    if (method === 'eth_getBlockByNumber' && params[0] === '0xc') return { number: '0xc', hash: `0x${'e'.repeat(64)}`, timestamp: '0x64' };
    if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
      if (!finalizedAvailable) throw new Error('unsupported finalized tag');
      return { number: '0xa', hash: canonicalHash, timestamp: '0x64' };
    }
    throw new Error('unexpected method');
  });
  const input = { chainId: 8453, txHash, confirmations: 1, finalityRequirement: 'RPC_FINALIZED' as const, rpcUrls: ['rpc'], rpcClient };
  const reorged = await observeEvm(input);
  assert.equal(reorged.status, 'REORGED');
  assert.equal(reorged.finalityState, 'REORGED');
  canonicalHash = blockHash;
  finalizedAvailable = false;
  const pending = await observeEvm(input);
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.temporalEvidence?.finalizedBlock, null);
});

test('EVM observer rejects receipt blocks ahead of the reported chain head', async () => {
  const rpcClient = mockRpcClient(async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x0', value: '0x1', input: '0x', blockNumber: '0xa', blockHash };
    if (method === 'eth_getTransactionReceipt') return { transactionHash: txHash, status: '0x1', blockNumber: '0xa', blockHash, gasUsed: '0x5208', logs: [] };
    if (method === 'eth_blockNumber') return '0x9';
    if (method === 'eth_getBlockByHash') return { number: '0xa', hash: blockHash, timestamp: '0x64' };
    throw new Error('unexpected method');
  });
  await assert.rejects(() => observeEvm({ chainId: 8453, txHash, confirmations: 0, rpcUrls: ['rpc'], rpcClient }), (error) => hasCode(error, 'RPC_FAILURE'));
});

test('EVM observer rejects removed or cross-transaction transfer logs', async () => {
  const otherHash = `0x${'2'.repeat(64)}`;
  const token = `0x${'d'.repeat(40)}`;
  const rpcClient = mockRpcClient(async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x0', value: '0x0', input: '0x12345678', blockNumber: '0xa', blockHash };
    if (method === 'eth_getTransactionReceipt') return { transactionHash: txHash, status: '0x1', blockNumber: '0xa', blockHash, gasUsed: '0x1', logs: [{ transactionHash: otherHash, blockHash, removed: true, address: token, topics: [transferTopic, addressTopic(sender), addressTopic(recipient)], data: `0x${'0'.repeat(63)}1`, logIndex: '0x0' }] };
    if (method === 'eth_blockNumber') return '0xa';
    if (method === 'eth_getBlockByHash') return { number: '0xa', hash: blockHash, timestamp: '0x64' };
    throw new Error('unexpected method');
  });
  await assert.rejects(() => observeEvm({ chainId: 8453, txHash, confirmations: 1, rpcUrls: ['rpc'], rpcClient }), (error) => hasCode(error, 'RPC_FAILURE'));
});

test('EVM observer ignores transfer-shaped logs with a non-word data field', async () => {
  const token = `0x${'d'.repeat(40)}`;
  const rpcClient = mockRpcClient(async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: sender, to: recipient, nonce: '0x0', value: '0x0', input: '0x12345678', blockNumber: '0xa', blockHash };
    if (method === 'eth_getTransactionReceipt') return { transactionHash: txHash, status: '0x1', blockNumber: '0xa', blockHash, gasUsed: '0x1', logs: [{ transactionHash: txHash, blockHash, removed: false, address: token, topics: [transferTopic, addressTopic(sender), addressTopic(recipient)], data: '0x2a', logIndex: '0x0' }] };
    if (method === 'eth_blockNumber') return '0xa';
    if (method === 'eth_getBlockByHash') return { number: '0xa', hash: blockHash, timestamp: '0x64' };
    throw new Error('unexpected method');
  });
  const observation = await observeEvm({ chainId: 8453, txHash, confirmations: 1, rpcUrls: ['rpc'], rpcClient });
  assert.deepEqual(observation.transfers, []);
});
