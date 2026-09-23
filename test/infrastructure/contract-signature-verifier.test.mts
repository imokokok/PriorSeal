import test from 'node:test';
import assert from 'node:assert/strict';
import { createContractSignatureVerifier } from '../../src/infrastructure/blockchain/evm/contract-signature-verifier.mjs';
import { buildAuthorization } from '../../src/domain/authorization.mjs';

const contractAddress = `0x${'c'.repeat(40)}`;
const authorization = buildAuthorization({
  intent: { intentId: 'erc1271-test', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender: `0x${'a'.repeat(40)}`, recipient: `0x${'b'.repeat(40)}`, validUntil: 2_000, nonce: '1' },
  principal: { type: 'organization', id: 'contract-owner', account: contractAddress },
  authorizer: { type: 'eip1271', address: contractAddress },
  delegate: { agentId: 'test-agent', executor: `0x${'a'.repeat(40)}` },
  issuedAt: 1_000,
  expiresAt: 2_000,
  authorizationNonce: `0x${'2'.repeat(64)}`,
  maxUses: '1',
  audience: 'priorseal',
  policyHash: `0x${'0'.repeat(64)}`,
});
const input = { authorization, digest: `0x${'d'.repeat(64)}` as `0x${string}`, signature: '0x01' };
const hasCode = (error: unknown, code: string) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;

test('ERC-1271 verifier ignores wrong-chain endpoints and accepts a valid identified fallback', async () => {
  const calls: Array<[string, string]> = [];
  const rpcClient = { async call(url: string, method: string): Promise<unknown> {
    calls.push([url, method]);
    if (method === 'eth_chainId') return url === 'wrong' ? '0x1' : '0x2105';
    return `0x1626ba7e${'0'.repeat(56)}`;
  } };
  const verify = createContractSignatureVerifier({ rpcClient, rpcUrls: () => ['wrong', 'base'] });
  assert.equal(await verify(input), true);
  assert.deepEqual(calls, [['wrong', 'eth_chainId'], ['base', 'eth_chainId'], ['base', 'eth_call']]);
});

test('ERC-1271 verifier distinguishes invalid signatures from unavailable chain state', async () => {
  const invalid = createContractSignatureVerifier({ rpcClient: { async call(_url: string, method: string): Promise<unknown> { return method === 'eth_chainId' ? '0x2105' : '0x'; } }, rpcUrls: () => ['base'] });
  assert.equal(await invalid(input), false);
  const unavailable = createContractSignatureVerifier({ rpcClient: { async call(): Promise<unknown> { throw new Error('offline'); } }, rpcUrls: () => ['base'] });
  await assert.rejects(() => unavailable(input), (error) => hasCode(error, 'AUTHORIZATION_VERIFIER_UNAVAILABLE'));
  const wrongChain = createContractSignatureVerifier({ rpcClient: { async call(): Promise<unknown> { return '0x1'; } }, rpcUrls: () => ['wrong'] });
  await assert.rejects(() => wrongChain(input), (error) => hasCode(error, 'AUTHORIZATION_VERIFIER_UNAVAILABLE'));
});
