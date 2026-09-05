import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpcClient } from '../../src/infrastructure/blockchain/evm/rpc-client.mjs';

test('RPC client retries invalid envelopes and returns a valid JSON-RPC result', async () => {
  let calls = 0;
  const metrics = { errors: 0, ok: 0, increment() { this.errors += 1; }, timing() { this.ok += 1; } };
  const client = createRpcClient({ retries: 1, sleep: async () => {}, metrics, fetchImpl: async () => ({ ok: true, async json() { calls += 1; return calls === 1 ? { jsonrpc: '2.0', id: 2, result: 'wrong-id' } : { jsonrpc: '2.0', id: 1, result: '0x2105' }; } }) });
  assert.equal(await client.call('https://rpc.invalid/secret', 'eth_chainId', []), '0x2105');
  assert.equal(calls, 2);
  assert.equal(metrics.errors, 1);
  assert.equal(metrics.ok, 1);
});

test('RPC client converts fetch failures to a stable non-sensitive error', async () => {
  const client = createRpcClient({ retries: 0, fetchImpl: async () => { throw new Error('https://rpc.invalid/private-token'); } });
  await assert.rejects(() => client.call('https://rpc.invalid/private-token', 'eth_chainId', []), (error) => error.code === 'RPC_FAILURE' && !error.message.includes('private-token'));
});
