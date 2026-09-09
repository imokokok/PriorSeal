import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildAuthorization, buildIntent, createMemoryStore } from '../../src/index.mjs';
import { observeExecution } from '../../src/application/observations/observe-execution.mjs';

const sender = `0x${'a'.repeat(40)}`;
const recipient = `0x${'b'.repeat(40)}`;
const txHash = `0x${'1'.repeat(64)}`;

test('observation is idempotent, linked to its intent, signed, and reorg-aware', async () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const store = createMemoryStore({ clock: () => 1_000_000 });
  const intent = buildIntent({ intentId: 'observe-1', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender, recipient, validUntil: 2_000, nonce: '0' });
  await store.saveIntent(intent);
  let calls = 0;
  const observer = async () => ({ schema: 'priorseal.execution-observation.v1', chainId: 8453, txHash, status: 'CONFIRMED', action: 'TRANSFER', executedAt: 900, observedAt: 1_000 + calls, sender, recipient, asset: intent.asset, amount: intent.amount, nonce: '0', confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED', blockNumber: 10, blockHash: `0x${(++calls === 1 ? 'c' : 'd').repeat(64)}`, observationSource: 'evm-json-rpc:eip155:8453:configured-1' });
  const options = { input: { intentId: intent.intentId, chainId: 8453, txHash, confirmations: 12 }, store, observer, privateKeyPem, publicKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_000_000 };

  const first = await observeExecution({ ...options, idempotencyKey: 'observation-1' });
  const replay = await observeExecution({ ...options, idempotencyKey: 'observation-1' });
  assert.equal(first.replay, false);
  assert.equal(replay.replay, true);
  assert.equal(calls, 1);
  assert.equal(first.response.observation.intentHash, intent.intentHash);
  assert.equal(first.response.verification.valid, true);
  assert.equal(first.response.receipt.outcome, 'COMPLETED');

  const reorg = await observeExecution({ ...options, idempotencyKey: 'observation-2' });
  assert.equal(reorg.response.observation.status, 'REORGED');
  assert.equal(reorg.response.observation.previousBlockHash, first.response.observation.blockHash);
  assert.equal(reorg.response.receipt.outcome, 'REORGED');
  assert.notEqual(reorg.response.receipt.receiptId, first.response.receipt.receiptId);
  assert.equal((await store.getReceipt(first.response.receipt.receiptId)).receiptId, first.response.receipt.receiptId);
});

test('pending transactions remain candidates and only final correlated execution claims authorization', async () => {
  const store = createMemoryStore();
  const authorization = buildAuthorization({ intent: { intentId: 'claim-safe', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender, recipient, validUntil: 2_000, nonce: '4' }, principal: { type: 'user', id: 'user-1', account: `0x${'c'.repeat(40)}` }, authorizer: { type: 'eip712', address: `0x${'c'.repeat(40)}` }, delegate: { agentId: 'agent-1', executor: sender }, issuedAt: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'8'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}`, signature: '0x01' });
  await store.saveIntent(authorization.intent);
  await store.saveAuthorization({ authorization, acceptance: { acceptedAt: 1_001 }, policyEvidence: { schema: 'priorseal.policy-evidence.v1', policyHash: authorization.policyHash, document: null, result: { allowed: true, reasonCodes: [], policyId: null, evaluatedAt: 1_001 } }, status: 'ACCEPTED', boundTxHash: null, uses: 0 });
  const hostileHash = `0x${'9'.repeat(64)}`;
  await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: hostileHash }, store, observer: async () => ({ chainId: 8453, txHash: hostileHash, status: 'PENDING', executionDataAvailable: true, sender: `0x${'d'.repeat(40)}`, nonce: '4', observedAt: 1_002 }) });
  assert.equal((await store.getAuthorization(authorization.authorizationId)).status, 'ACCEPTED');
  const expectedHash = `0x${'7'.repeat(64)}`;
  await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: expectedHash }, store, observer: async () => ({ chainId: 8453, txHash: expectedHash, status: 'PENDING', executionDataAvailable: true, sender, nonce: '4', observedAt: 1_003 }) });
  const candidate = await store.getAuthorization(authorization.authorizationId);
  assert.equal(candidate.status, 'ACCEPTED');
  assert.equal(candidate.boundTxHash, null);
  const replacementHash = `0x${'6'.repeat(64)}`;
  const final = await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: replacementHash }, store, observer: async () => ({ chainId: 8453, txHash: replacementHash, status: 'CONFIRMED', executionDataAvailable: true, action: 'TRANSFER', sender, recipient, asset: authorization.intent.asset, amount: authorization.intent.amount, nonce: '4', executedAt: 1_004, observedAt: 1_005, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' }) });
  assert.equal(final.response.authorizationAssociation, 'FINAL');
  const claimed = await store.getAuthorization(authorization.authorizationId);
  assert.equal(claimed.status, 'BOUND');
  assert.equal(claimed.boundTxHash, replacementHash);
});

test('pending candidate reports non-assessable compliance without consuming authorization', async () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const authorization = buildAuthorization({ intent: { intentId: 'pending-candidate', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender, recipient, validUntil: 2_000, nonce: '5' }, principal: { type: 'user', id: 'user-1', account: `0x${'c'.repeat(40)}` }, authorizer: { type: 'eip712', address: `0x${'c'.repeat(40)}` }, delegate: { agentId: 'agent-1', executor: sender }, issuedAt: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'5'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}`, signature: '0x01' });
  const store = createMemoryStore();
  await store.saveIntent(authorization.intent);
  await store.saveAuthorization({ authorization, acceptance: { acceptedAt: 1_001 }, policyEvidence: { schema: 'priorseal.policy-evidence.v1', policyHash: authorization.policyHash, document: null, result: { allowed: true, reasonCodes: [], policyId: null, evaluatedAt: 1_001 } }, status: 'ACCEPTED', boundTxHash: null, uses: 0 });
  const pendingHash = `0x${'5'.repeat(64)}`;
  const result = await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: pendingHash }, store, observer: async () => ({ chainId: 8453, txHash: pendingHash, status: 'PENDING', executionDataAvailable: true, action: 'TRANSFER', sender, recipient, asset: authorization.intent.asset, amount: authorization.intent.amount, nonce: '5', observedAt: 1_002, finalityState: 'PENDING' }), privateKeyPem, publicKeyPem, issuer: 'test', keyId: 'key-1', now: () => 1_002_000 });
  assert.equal(result.response.authorizationAssociation, 'CANDIDATE');
  assert.equal(result.response.receipt.compliance.status, 'NOT_ASSESSABLE');
  assert.deepEqual(result.response.receipt.compliance.reasonCodes, ['EXECUTION_PENDING']);
  assert.equal((await store.getAuthorization(authorization.authorizationId)).boundTxHash, null);
});

test('signed confirmation constraints cannot be relaxed by the observer request', async () => {
  const store = createMemoryStore(); let confirmations;
  const intent = buildIntent({ intentId: 'finality-floor', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender, recipient, validUntil: 2_000, constraints: { minConfirmations: 12 } });
  await store.saveIntent(intent);
  await observeExecution({ input: { intentId: intent.intentId, txHash, confirmations: 0 }, store, observer: async (input) => { confirmations = input.confirmations; return { chainId: 8453, txHash, status: 'PENDING', executionDataAvailable: true, sender, nonce: '0', observedAt: 1_001 }; } });
  assert.equal(confirmations, 12);
  await assert.rejects(() => observeExecution({ input: { intentId: intent.intentId, txHash, confirmations: -1 }, store, observer: async () => ({}) }), (error) => error.code === 'INVALID_REQUEST');
});

test('observation idempotency rejects a reused key with different input', async () => {
  const store = createMemoryStore({ clock: () => 1_000 });
  const intent = buildIntent({ intentId: 'observe-conflict', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender, recipient, validUntil: 2_000 });
  await store.saveIntent(intent);
  const observer = async ({ txHash: hash }) => ({ chainId: 8453, txHash: hash, status: 'PENDING', action: 'TRANSFER', observedAt: 1, sender, recipient, asset: intent.asset, amount: intent.amount, finalityState: 'PENDING' });
  const base = { store, observer, issuer: 'test', now: () => 1_000, idempotencyKey: 'same' };
  await observeExecution({ ...base, input: { intentId: intent.intentId, txHash } });
  await assert.rejects(() => observeExecution({ ...base, input: { intentId: intent.intentId, txHash: `0x${'2'.repeat(64)}` } }), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
});

test('intent rejects impossible confirmation floors and cross-chain assets', () => {
  const base = { intentId: 'invalid-finality', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender, recipient, validUntil: 2_000 };
  assert.throws(() => buildIntent({ ...base, constraints: { minConfirmations: 10_001 } }), (error) => error.code === 'INVALID_CONSTRAINT');
  assert.throws(() => buildIntent({ ...base, asset: 'eip155:1/native' }), (error) => error.code === 'INVALID_ASSET');
});
