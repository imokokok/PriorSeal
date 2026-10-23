import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationReadinessInspector } from '../../src/infrastructure/blockchain/evm/integration-readiness.mjs';

const address = `0x${'a'.repeat(40)}`;

test('readiness inspector performs only chain identity and bytecode reads', async () => {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const inspector = createIntegrationReadinessInspector({
    rpcUrls: (chainId) => chainId === 8453 ? ['https://rpc.example.test'] : [],
    rpcClient: { async call(_url: string, method: string, params: unknown[]) {
      calls.push({ method, params });
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_getCode') return '0x60016000';
      throw new Error('unexpected RPC method');
    } } as never,
  });
  const result = await inspector({ chainId: 8453, subjectAddress: address });
  assert.deepEqual(calls, [{ method: 'eth_chainId', params: [] }, { method: 'eth_getCode', params: [address, 'latest'] }]);
  assert.equal(result.chain.rpc, 'AVAILABLE');
  assert.equal(result.subject.kind, 'CONTRACT');
  assert.equal(result.subject.codeBytes, 4);
  assert.match(result.subject.codeHash ?? '', /^0x[0-9a-f]{64}$/);
});

test('readiness inspector reports unsupported, unavailable, and wrong-chain states without probing bytecode', async () => {
  const unavailable = createIntegrationReadinessInspector({ rpcUrls: () => [] });
  assert.deepEqual(await unavailable({ chainId: 8453, subjectAddress: address }), {
    chain: { support: 'SUPPORTED', rpc: 'NOT_CONFIGURED', observedChainId: null, source: null },
    subject: { kind: 'NOT_OBSERVED', codeHash: null, codeBytes: null },
  });
  assert.equal((await unavailable({ chainId: 999_999, subjectAddress: address })).chain.support, 'UNSUPPORTED');
  const wrongChain = createIntegrationReadinessInspector({
    rpcUrls: () => ['https://rpc.example.test'],
    rpcClient: { async call() { return '0x1'; } } as never,
  });
  const result = await wrongChain({ chainId: 8453, subjectAddress: address });
  assert.deepEqual(result, {
    chain: { support: 'SUPPORTED', rpc: 'CHAIN_ID_MISMATCH', observedChainId: 1, source: 'evm-json-rpc' },
    subject: { kind: 'NOT_OBSERVED', codeHash: null, codeBytes: null },
  });
});
