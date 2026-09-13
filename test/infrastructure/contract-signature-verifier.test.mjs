import test from 'node:test';
import assert from 'node:assert/strict';
import { createContractSignatureVerifier } from '../../src/infrastructure/blockchain/evm/contract-signature-verifier.mjs';

const authorization = { intent: { chainId: 8453 }, authorizer: { address: `0x${'c'.repeat(40)}` } };
const input = { authorization, digest: `0x${'d'.repeat(64)}`, signature: '0x01' };

test('ERC-1271 verifier ignores wrong-chain endpoints and accepts a valid identified fallback', async () => {
  const calls = [];
  const rpcClient = { async call(url, method) {
    calls.push([url, method]);
    if (method === 'eth_chainId') return url === 'wrong' ? '0x1' : '0x2105';
    return `0x1626ba7e${'0'.repeat(56)}`;
  } };
  const verify = createContractSignatureVerifier({ rpcClient, rpcUrls: () => ['wrong', 'base'] });
  assert.equal(await verify(input), true);
  assert.deepEqual(calls, [['wrong', 'eth_chainId'], ['base', 'eth_chainId'], ['base', 'eth_call']]);
});

test('ERC-1271 verifier distinguishes invalid signatures from unavailable chain state', async () => {
  const invalid = createContractSignatureVerifier({ rpcClient: { async call(_url, method) { return method === 'eth_chainId' ? '0x2105' : '0x'; } }, rpcUrls: () => ['base'] });
  assert.equal(await invalid(input), false);
  const unavailable = createContractSignatureVerifier({ rpcClient: { async call() { throw new Error('offline'); } }, rpcUrls: () => ['base'] });
  await assert.rejects(() => unavailable(input), (error) => error.code === 'AUTHORIZATION_VERIFIER_UNAVAILABLE');
  const wrongChain = createContractSignatureVerifier({ rpcClient: { async call() { return '0x1'; } }, rpcUrls: () => ['wrong'] });
  await assert.rejects(() => wrongChain(input), (error) => error.code === 'AUTHORIZATION_VERIFIER_UNAVAILABLE');
});
