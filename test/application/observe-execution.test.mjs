import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildIntent, createMemoryStore } from '../../src/index.mjs';
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
  const observer = async () => ({ schema: 'runproof.execution-observation.v1', chainId: 8453, txHash, status: 'CONFIRMED', action: 'TRANSFER', executedAt: 900, observedAt: 1_000 + calls, sender, recipient, asset: intent.asset, amount: intent.amount, nonce: '0', confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED', blockNumber: 10, blockHash: `0x${(++calls === 1 ? 'c' : 'd').repeat(64)}`, observationSource: 'evm-json-rpc:eip155:8453:configured-1' });
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

test('observation idempotency rejects a reused key with different input', async () => {
  const store = createMemoryStore({ clock: () => 1_000 });
  const intent = buildIntent({ intentId: 'observe-conflict', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender, recipient, validUntil: 2_000 });
  await store.saveIntent(intent);
  const observer = async ({ txHash: hash }) => ({ chainId: 8453, txHash: hash, status: 'PENDING', action: 'TRANSFER', observedAt: 1, sender, recipient, asset: intent.asset, amount: intent.amount, finalityState: 'PENDING' });
  const base = { store, observer, issuer: 'test', now: () => 1_000, idempotencyKey: 'same' };
  await observeExecution({ ...base, input: { intentId: intent.intentId, txHash } });
  await assert.rejects(() => observeExecution({ ...base, input: { intentId: intent.intentId, txHash: `0x${'2'.repeat(64)}` } }), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
});
