import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpcClient } from '../../src/infrastructure/blockchain/evm/rpc-client.mjs';

test('RPC client retries invalid envelopes and returns a valid JSON-RPC result', async () => {
  let calls = 0;
  const metrics = { errors: 0, ok: 0, increment() { this.errors += 1; }, timing() { this.ok += 1; } };
  const client = createRpcClient({ retries: 1, sleep: async () => {}, metrics, fetchImpl: async () => new Response(JSON.stringify(calls++ === 0 ? { jsonrpc: '2.0', id: 2, result: 'wrong-id' } : { jsonrpc: '2.0', id: 1, result: '0x2105' }), { headers: { 'content-type': 'application/json' } }) });
  assert.equal(await client.call('https://rpc.invalid/secret', 'eth_chainId', []), '0x2105');
  assert.equal(calls, 2);
  assert.equal(metrics.errors, 1);
  assert.equal(metrics.ok, 1);
});

test('RPC client converts fetch failures to a stable non-sensitive error', async () => {
  const client = createRpcClient({ retries: 0, fetchImpl: async () => { throw new Error('https://rpc.invalid/private-token'); } });
  await assert.rejects(() => client.call('https://rpc.invalid/private-token', 'eth_chainId', []), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'RPC_FAILURE' && !error.message.includes('private-token'));
});

test('RPC client rejects malformed result and contradictory JSON-RPC envelopes', async () => {
  for (const body of [
    { jsonrpc: '2.0', id: 1 },
    { jsonrpc: '2.0', id: 1, result: '0x2105', error: { code: -1, message: 'contradictory' } },
    { jsonrpc: '2.0', id: 1, result: { chainId: '0x2105' } },
    { jsonrpc: '2.0', id: 1, result: null },
  ]) {
    const client = createRpcClient({ retries: 0, fetchImpl: async () => Response.json(body) });
    await assert.rejects(() => client.call('https://rpc.invalid', 'eth_chainId', []), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'RPC_INVALID_RESPONSE');
  }
});

test('RPC client validates the transaction and receipt shapes before returning typed data', async () => {
  for (const [method, result] of [
    ['eth_getTransactionByHash', { hash: `0x${'1'.repeat(64)}`, nonce: null }],
    ['eth_getTransactionReceipt', { status: '0x1', blockNumber: '0xa', gasUsed: '0x1', blockHash: null }],
    ['eth_getBlockByHash', { timestamp: { hex: '0x1' } }],
    ['eth_call', 'not-hex'],
  ] as const) {
    const client = createRpcClient({ retries: 0, fetchImpl: async () => Response.json({ jsonrpc: '2.0', id: 1, result }) });
    await assert.rejects(() => client.call('https://rpc.invalid', method, []), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'RPC_INVALID_RESPONSE');
  }
});
