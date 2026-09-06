import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { authorizeIntent, authorizationTypedData, buildAuthorization, buildAuthorizedReceipt, buildIntent, buildReceipt, createMemoryStore } from '../../src/index.mjs';
import { signReceipt } from '../../src/domain/receipt.mjs';
import { verifyReceiptLocally } from '../../sdk/dist/verifier.js';

function issuerKeys() {
  const keys = generateKeyPairSync('ed25519');
  return {
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

function trustedKey(publicKey) {
  return { issuer: 'test', keyId: 'key-1', algorithm: 'Ed25519', publicKey, status: 'active', validFrom: null, validUntil: null };
}

test('SDK verifier validates a v1 receipt locally and detects mutations', async () => {
  const keys = issuerKeys();
  const sender = `0x${'a'.repeat(40)}`;
  const recipient = `0x${'b'.repeat(40)}`;
  const intent = buildIntent({ intentId: 'sdk-v1', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender, recipient, validUntil: 2_000, nonce: '1' });
  const execution = { chainId: 8453, txHash: `0x${'1'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', executedAt: 1_100, observedAt: 1_101, sender, recipient, asset: intent.asset, amount: intent.amount, finalityState: 'CONFIRMED' };
  const receipt = signReceipt(buildReceipt({ intent, execution, issuer: 'test', keyId: 'key-1', issuedAt: 1_101 }), keys.privateKey);
  const verified = await verifyReceiptLocally(receipt, { trustedKeys: { schema: 'priorseal.keys.v1', issuer: 'test', keys: [trustedKey(keys.publicKey)] }, now: 1_200 });
  assert.equal(verified.valid, true);
  assert.equal(verified.verificationScope, 'LOCAL_COMPLETE');
  assert.deepEqual(verified.requiredExternalChecks, []);
  assert.equal((await verifyReceiptLocally({ ...receipt, executionHash: 'changed' }, { trustedKeys: trustedKey(keys.publicKey), now: 1_200 })).code, 'EXECUTION_HASH_MISMATCH');
});

test('SDK verifier independently validates authorization v2, policy, binding and signatures', async () => {
  const keys = issuerKeys();
  const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const executor = `0x${'a'.repeat(40)}`;
  const intent = { intentId: 'sdk-v2', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender: executor, recipient: `0x${'b'.repeat(40)}`, validUntil: 2_000, nonce: '7' };
  const draft = buildAuthorization({ intent, principal: { type: 'user', id: 'user-1', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'agent-1', executor }, issuedAt: 1_000, notBefore: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'2'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}` });
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  const accepted = await authorizeIntent({ input: authorization, store: createMemoryStore({ clock: () => 1_001_000 }), privateKeyPem: keys.privateKey, issuer: 'test', keyId: 'key-1', now: () => 1_001_000 });
  const execution = { chainId: 8453, txHash: `0x${'3'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', sender: executor, recipient: intent.recipient, asset: intent.asset, amount: intent.amount, nonce: intent.nonce, executedAt: 1_100, observedAt: 1_101, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' };
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence, execution, issuer: 'test', keyId: 'key-1', issuedAt: 1_101 }), keys.privateKey);
  const verified = await verifyReceiptLocally(receipt, { trustedKeys: [trustedKey(keys.publicKey)], now: 1_200 });
  assert.equal(verified.valid, true);
  assert.equal(verified.code, 'OK');
  assert.equal(verified.authorizationId, authorization.authorizationId);
  const mutated = structuredClone(receipt);
  mutated.authorizationEvidence.authorization.delegate.agentId = 'agent-impersonated';
  assert.equal((await verifyReceiptLocally(mutated, { trustedKeys: trustedKey(keys.publicKey), now: 1_200 })).code, 'AUTHORIZATION_ID_MISMATCH');
});

test('SDK verifier reports chain-state requirements without making network calls', async () => {
  const receipt = { issuer: 'test', keyId: 'key-1', outcome: 'UNDETERMINED', receiptId: 'psr_external', authorizationEvidence: { authorization: { authorizer: { type: 'eip1271', address: `0x${'c'.repeat(40)}` }, intent: { chainId: 8453 } }, transparency: { checkpoint: { anchor: { type: 'eip155', chainId: 1, contract: `0x${'d'.repeat(40)}`, txHash: `0x${'e'.repeat(64)}`, blockNumber: 10 } } } } };
  const result = await verifyReceiptLocally(receipt, { trustedKeys: [] });
  assert.equal(result.verificationScope, 'EXTERNAL_CHECK_REQUIRED');
  assert.deepEqual(result.requiredExternalChecks.map((check) => check.type), ['ERC1271', 'EVM_ANCHOR']);
});
