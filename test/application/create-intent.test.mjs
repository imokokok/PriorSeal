import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntent } from '../../src/application/intents/create-intent.mjs';
import { createMemoryStore } from '../../src/index.mjs';

const input = {
  intentId: 'application-intent-1',
  chainId: 8453,
  action: 'TRANSFER',
  asset: 'eip155:8453/native',
  amount: '1000000',
  sender: `0x${'a'.repeat(40)}`,
  recipient: `0x${'b'.repeat(40)}`,
  validUntil: 2_000_000_000,
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
  await assert.rejects(() => createIntent({ input, store, policy: { allowedChainIds: [1] } }), (error) => error.code === 'POLICY_REJECTED');
  await assert.rejects(() => createIntent({ input, store, idempotencyKey: 'not safe' }), (error) => error.code === 'INVALID_IDEMPOTENCY_KEY');
});
