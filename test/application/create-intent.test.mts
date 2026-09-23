import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntent } from '../../src/application/intents/create-intent.mjs';
import { createMemoryStore } from '../../src/index.mjs';

function hasCode(error: unknown, code: string): error is { code: string; details?: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

const input = {
  intentId: 'application-intent-1',
  chainId: 8453,
  action: 'TRANSFER',
  asset: 'eip155:8453/native',
  amount: '1000000',
  sender: `0x${'a'.repeat(40)}`,
  recipient: `0x${'b'.repeat(40)}`,
  validUntil: 2_000_000_000,
  nonce: '7',
};

test('create intent coordinates policy, persistence, and idempotent replay', async () => {
  const now = () => 1_000;
  const store = createMemoryStore({ clock: now });
  const options = { input, idempotencyKey: 'application-intent-1', store, now };
  const created = await createIntent(options);
  const replayed = await createIntent(options);

  assert.equal(created.replay, false);
  assert.equal(replayed.replay, true);
  assert.equal(await store.getIntent(input.intentId), created.response.intent);
});

test('create intent rejects policy violations and unsafe idempotency keys', async () => {
  const store = createMemoryStore();
  await assert.rejects(() => createIntent({ input, store, policy: { allowedChainIds: [1] } }), (error) => hasCode(error, 'POLICY_REJECTED'));
  await assert.rejects(() => createIntent({ input, store, idempotencyKey: 'not safe' }), (error) => hasCode(error, 'INVALID_IDEMPOTENCY_KEY'));
});

test('create intent rejects misleading exact-call semantic policy constraints', async () => {
  const store = createMemoryStore();
  const exact = {
    ...input,
    schema: 'priorseal.intent.v2',
    executionProfile: 'priorseal.execution-profile.exact-call.v1',
    action: 'CONTRACT_CALL',
    nonce: '7',
    callTarget: input.recipient,
    calldataHash: `0x${'1'.repeat(64)}`,
    transactionValue: '0',
  };
  await assert.rejects(
    () => createIntent({ input: exact, store, policy: { allowedChainIds: [8453], maxAmount: '1000000' } }),
    (error) => hasCode(error, 'POLICY_REJECTED')
      && typeof error.details === 'object' && error.details !== null && 'reasonCodes' in error.details
      && Array.isArray(error.details.reasonCodes) && error.details.reasonCodes.includes('POLICY_EXACT_CALL_SEMANTICS_UNSUPPORTED'),
  );
});

test('new intent issuance rejects legacy multi-chain and ambiguous constraint representations', async () => {
  const store = createMemoryStore();
  const { nonce, ...withoutNonce } = input;
  await assert.rejects(() => createIntent({ input: withoutNonce, store }), (error) => hasCode(error, 'INVALID_INTENT'));
  await assert.rejects(() => createIntent({ input: { ...input, chainIds: [1, 8453] }, store }), (error) => hasCode(error, 'INVALID_INTENT'));
  await assert.rejects(() => createIntent({ input: { ...input, constraints: { minConfirmations: '12' } }, store }), (error) => hasCode(error, 'INVALID_CONSTRAINT'));
});
