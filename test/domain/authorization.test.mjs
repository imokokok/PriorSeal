import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { authorizeIntent, authorizationTypedData, buildAuthorization, buildAuthorizedReceipt, createMemoryStore, hashJson, verifyAuthorization, verifyAuthorizedReceipt } from '../../src/index.mjs';
import { signReceipt } from '../../src/domain/receipt.mjs';
import { observeExecution } from '../../src/application/observations/observe-execution.mjs';

const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const executor = `0x${'a'.repeat(40)}`;
const intentInput = { intentId: 'authorized-intent-1', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender: executor, recipient: `0x${'b'.repeat(40)}`, validUntil: 2_000, nonce: '7' };

async function signedAuthorization(intent = intentInput, nonceByte = '2') {
  const draft = buildAuthorization({ intent, principal: { type: 'user', id: 'user-1', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'agent-1', executor }, issuedAt: 1_000, notBefore: 1_000, expiresAt: 2_000, authorizationNonce: `0x${nonceByte.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}` });
  return buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
}

test('EOA authorization proves the signer approved canonical intent and agent fields', async () => {
  const authorization = await signedAuthorization();
  assert.equal(authorization.schema, 'priorseal.authorization.v2');
  assert.equal((await verifyAuthorization(authorization, { now: 1_001 })).valid, true);
  assert.equal((await verifyAuthorization({ ...authorization, delegate: { ...authorization.delegate, executor: `0x${'c'.repeat(40)}` } }, { now: 1_001 })).valid, false);
  const { authorizationId, ...withoutId } = authorization;
  const changedAgent = buildAuthorization({ ...withoutId, delegate: { ...authorization.delegate, agentId: 'agent-impersonated' } });
  assert.equal((await verifyAuthorization(changedAgent, { now: 1_001 })).code, 'INVALID_AUTHORIZATION_SIGNATURE');
});

test('legacy v1 authorizations remain verifiable', async () => {
  const current = buildAuthorization({ intent: intentInput, principal: { type: 'user', id: 'user-1', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'legacy-label', executor }, issuedAt: 1_000, notBefore: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'3'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}`, schema: 'priorseal.authorization.v1', domain: 'priorseal/authorization/v1' });
  const legacy = buildAuthorization({ ...current, signature: await account.signTypedData(authorizationTypedData(current)) });
  assert.equal((await verifyAuthorization(legacy, { now: 1_001 })).valid, true);
});

test('accepted authorization is single-use and produces a self-checking v2 receipt', async () => {
  const issuerKeys = generateKeyPairSync('ed25519');
  const privateKeyPem = issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = issuerKeys.publicKey.export({ type: 'spki', format: 'pem' });
  const authorization = await signedAuthorization();
  const store = createMemoryStore({ clock: () => 1_001_000 });
  const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_001_000 });
  const execution = { chainId: 8453, txHash: `0x${'3'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', sender: executor, recipient: intentInput.recipient, asset: intentInput.asset, amount: intentInput.amount, nonce: intentInput.nonce, executedAt: 1_100, observedAt: 1_101, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' };
  assert.equal((await store.bindAuthorization(authorization.authorizationId, execution.txHash)).ok, true);
  assert.equal((await store.bindAuthorization(authorization.authorizationId, `0x${'4'.repeat(64)}`)).code, 'AUTHORIZATION_ALREADY_USED');
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, execution, issuer: 'test', keyId: 'key-1', issuedAt: 1_101 }), privateKeyPem);
  assert.equal(receipt.binding.bound, true);
  assert.equal((await verifyAuthorizedReceipt(receipt, publicKeyPem)).valid, true);
  assert.equal((await verifyAuthorizedReceipt(receipt, publicKeyPem, { key: { keyId: 'key-1', issuer: 'test', algorithm: 'Ed25519', status: 'revoked', validFrom: null, validUntil: null } })).code, 'INVALID_KEY');
  assert.equal((await verifyAuthorizedReceipt(receipt, publicKeyPem, { key: { keyId: 'key-1', issuer: 'test', algorithm: 'Ed25519', status: 'retired', validFrom: 1_050, validUntil: null } })).code, 'KEY_NOT_YET_VALID');
  assert.equal((await verifyAuthorizedReceipt(receipt, publicKeyPem, { now: 1_000 })).code, 'NOT_YET_VALID');
  assert.equal((await verifyAuthorizedReceipt({ ...receipt, outcome: 'FAILED' }, publicKeyPem)).code, 'OUTCOME_MISMATCH');
});

test('exact-call constraints are signed and calldata mismatch prevents completion', async () => {
  const issuerKeys = generateKeyPairSync('ed25519');
  const privateKeyPem = issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = issuerKeys.publicKey.export({ type: 'spki', format: 'pem' });
  const exactIntent = { ...intentInput, intentId: 'exact-call-1', callTarget: intentInput.recipient, calldataHash: `0x${'5'.repeat(64)}`, transactionValue: '10' };
  const authorization = await signedAuthorization(exactIntent, '6');
  const store = createMemoryStore({ clock: () => 1_001_000 });
  const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_001_000 });
  const execution = { chainId: 8453, txHash: `0x${'7'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', sender: executor, recipient: intentInput.recipient, target: intentInput.recipient, calldataHash: `0x${'8'.repeat(64)}`, nativeValue: '10', asset: intentInput.asset, amount: intentInput.amount, nonce: intentInput.nonce, executedAt: 1_100, observedAt: 1_101, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' };
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, execution, issuer: 'test', keyId: 'key-1', issuedAt: 1_101 }), privateKeyPem);
  assert.equal(receipt.binding.bound, false);
  assert.deepEqual(receipt.reasonCodes, ['CALLDATA_MISMATCH']);
  assert.equal(receipt.outcome, 'UNDETERMINED');
  assert.equal((await verifyAuthorizedReceipt(receipt, publicKeyPem)).valid, true);
});

test('authorization accepted after execution is preserved as evidence but never marked completed', async () => {
  const issuerKeys = generateKeyPairSync('ed25519');
  const privateKeyPem = issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = issuerKeys.publicKey.export({ type: 'spki', format: 'pem' });
  const authorization = await signedAuthorization({ ...intentInput, intentId: 'post-hoc-1' }, '9');
  const store = createMemoryStore({ clock: () => 1_200_000 });
  const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_200_000 });
  const execution = { chainId: 8453, txHash: `0x${'a'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', sender: executor, recipient: intentInput.recipient, asset: intentInput.asset, amount: intentInput.amount, nonce: intentInput.nonce, executedAt: 1_100, observedAt: 1_201, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' };
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, execution, issuer: 'test', keyId: 'key-1', issuedAt: 1_201 }), privateKeyPem);
  assert.equal(receipt.binding.bound, false);
  assert.ok(receipt.reasonCodes.includes('AUTHORIZATION_AFTER_EXECUTION'));
  assert.equal(receipt.outcome, 'UNDETERMINED');
  assert.equal((await verifyAuthorizedReceipt(receipt, publicKeyPem)).valid, true);
});

test('execution outside the narrower authorization window never completes', async () => {
  const issuerKeys = generateKeyPairSync('ed25519');
  const privateKeyPem = issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = issuerKeys.publicKey.export({ type: 'spki', format: 'pem' });
  const draft = buildAuthorization({ intent: { ...intentInput, intentId: 'authorization-window-1' }, principal: { type: 'user', id: 'user-1', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'agent-1', executor }, issuedAt: 1_000, notBefore: 1_000, expiresAt: 1_200, authorizationNonce: `0x${'d'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}` });
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  const store = createMemoryStore({ clock: () => 1_001_000 });
  const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_001_000 });
  const execution = { chainId: 8453, txHash: `0x${'e'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', sender: executor, recipient: intentInput.recipient, asset: intentInput.asset, amount: intentInput.amount, nonce: intentInput.nonce, executedAt: 1_300, observedAt: 1_301, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' };
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, execution, issuer: 'test', keyId: 'key-1', issuedAt: 1_301 }), privateKeyPem);
  assert.deepEqual(receipt.reasonCodes, ['OUTSIDE_AUTHORIZATION_WINDOW']);
  assert.equal(receipt.outcome, 'UNDETERMINED');
  assert.equal((await verifyAuthorizedReceipt(receipt, publicKeyPem)).valid, true);
});

test('v2 receipt embeds and verifies the principal identity policy snapshot', async () => {
  const issuerKeys = generateKeyPairSync('ed25519');
  const privateKeyPem = issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = issuerKeys.publicKey.export({ type: 'spki', format: 'pem' });
  const policy = { policyId: 'identity-v1', principals: [{ id: 'verified-user', type: 'user', account: account.address, authorizerType: 'eip712' }], allowedChainIds: [8453] };
  const draft = buildAuthorization({ intent: { ...intentInput, intentId: 'identity-policy-1' }, principal: { type: 'user', id: 'verified-user', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'agent-1', executor }, issuedAt: 1_000, notBefore: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'f'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${hashJson(policy)}` });
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  const store = createMemoryStore({ clock: () => 1_001_000 });
  const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem, issuer: 'test', keyId: 'key-1', policy, now: () => 1_001_000 });
  const execution = { chainId: 8453, txHash: `0x${'1'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', sender: executor, recipient: intentInput.recipient, asset: intentInput.asset, amount: intentInput.amount, nonce: intentInput.nonce, executedAt: 1_100, observedAt: 1_101, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' };
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence, execution, issuer: 'test', keyId: 'key-1', issuedAt: 1_101 }), privateKeyPem);
  assert.equal(receipt.authorizationEvidence.policy.document.policyId, 'identity-v1');
  assert.equal((await verifyAuthorizedReceipt(receipt, publicKeyPem)).valid, true);
  const mutated = structuredClone(receipt);
  mutated.authorizationEvidence.policy.document.principals[0].id = 'lookalike';
  assert.equal((await verifyAuthorizedReceipt(mutated, publicKeyPem)).code, 'INVALID_POLICY_EVIDENCE');
});

test('required transparency failure does not consume the authorization', async () => {
  const issuerKeys = generateKeyPairSync('ed25519');
  const privateKeyPem = issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const authorization = await signedAuthorization({ ...intentInput, intentId: 'anchor-gate-1' }, '3');
  const store = createMemoryStore({ clock: () => 1_001_000 });
  await authorizeIntent({ input: authorization, store, privateKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_001_000 });
  const txHash = `0x${'4'.repeat(64)}`;
  const observer = async () => ({ chainId: 8453, txHash, status: 'CONFIRMED', action: 'TRANSFER', sender: executor, recipient: intentInput.recipient, asset: intentInput.asset, amount: intentInput.amount, nonce: intentInput.nonce, executedAt: 1_100, observedAt: 1_101, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' });
  await assert.rejects(() => observeExecution({ input: { authorizationId: authorization.authorizationId, chainId: 8453, txHash, confirmations: 12 }, store, observer, transparencyProvider: async () => { const error = new Error('anchor required'); error.code = 'TRANSPARENCY_ANCHOR_REQUIRED'; throw error; } }), (error) => error.code === 'TRANSPARENCY_ANCHOR_REQUIRED');
  assert.equal((await store.getAuthorization(authorization.authorizationId)).boundTxHash, null);
});

test('legacy authorization schemas cannot be newly accepted', async () => {
  const issuerKeys = generateKeyPairSync('ed25519');
  const privateKeyPem = issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const draft = buildAuthorization({ intent: { ...intentInput, intentId: 'legacy-issuance' }, principal: { type: 'user', id: 'user-1', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'legacy-label', executor }, issuedAt: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'4'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}`, schema: 'priorseal.authorization.v1', domain: 'priorseal/authorization/v1' });
  const legacy = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  await assert.rejects(() => authorizeIntent({ input: legacy, store: createMemoryStore(), privateKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_001_000 }), (error) => error.code === 'INVALID_AUTHORIZATION');
});

test('authorization nonce uniqueness and atomic acceptance are enforced in memory', async () => {
  const issuerKeys = generateKeyPairSync('ed25519');
  const privateKeyPem = issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const store = createMemoryStore();
  const first = await signedAuthorization({ ...intentInput, intentId: 'nonce-first' }, '5');
  const second = await signedAuthorization({ ...intentInput, intentId: 'nonce-second' }, '5');
  await authorizeIntent({ input: first, store, privateKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_001_000 });
  await assert.rejects(() => authorizeIntent({ input: second, store, privateKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_001_000 }), (error) => error.code === 'AUTHORIZATION_NONCE_REUSED');
  const before = (await store.listAuthorizationLog()).length;
  const atomicFailure = await signedAuthorization({ ...intentInput, intentId: 'atomic-failure' }, '6');
  await assert.rejects(() => store.saveAcceptedAuthorization({ authorization: atomicFailure, acceptedAt: 1_001, createRecord: () => { throw new Error('signing failed'); } }), /signing failed/);
  assert.equal((await store.listAuthorizationLog()).length, before);
});
