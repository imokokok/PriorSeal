import assert from 'node:assert/strict';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';

import {
  HYPERCORE_SIGNING_NAME,
  HYPERCORE_SIGNING_VERSION,
  HYPERCORE_USD_SEND_PRIMARY_TYPE,
  HYPERCORE_X402_MAINNET,
  HYPERCORE_ZERO_ADDRESS,
  createHypercorePaymentRequirement,
  type HypercorePaymentPayload,
} from '../../src/infrastructure/payments/hypercore-x402-protocol.mjs';
import {
  HypercorePaymentCoordinator,
  type HypercorePaymentStore,
} from '../../src/hypercore-x402/coordinator.mjs';

const signer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const payTo = `0x${'2'.repeat(40)}` as `0x${string}`;
const timestamp = 1_800_000_000_000;

const usdSendTypes = {
  [HYPERCORE_USD_SEND_PRIMARY_TYPE]: [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'destination', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'time', type: 'uint64' },
  ],
} as const;

function signatureObject(signature: `0x${string}`) {
  return {
    r: `0x${signature.slice(2, 66)}` as `0x${string}`,
    s: `0x${signature.slice(66, 130)}` as `0x${string}`,
    v: Number.parseInt(signature.slice(130, 132), 16),
  };
}

async function signedPayment(quoteId: string, amount = '0.02'): Promise<HypercorePaymentPayload> {
  const requirement = createHypercorePaymentRequirement({
    network: HYPERCORE_X402_MAINNET, amount, payTo, quoteId, maxTimeoutSeconds: 60,
  });
  const action = {
    type: 'usdSend' as const,
    hyperliquidChain: 'Mainnet' as const,
    signatureChainId: '0xa4b1',
    destination: payTo,
    amount,
    time: timestamp,
  };
  const signature = await signer.signTypedData({
    domain: {
      name: HYPERCORE_SIGNING_NAME, version: HYPERCORE_SIGNING_VERSION, chainId: 42161,
      verifyingContract: HYPERCORE_ZERO_ADDRESS,
    },
    types: usdSendTypes,
    primaryType: HYPERCORE_USD_SEND_PRIMARY_TYPE,
    message: { hyperliquidChain: action.hyperliquidChain, destination: action.destination, amount: action.amount, time: BigInt(action.time) },
  });
  return {
    x402Version: 2,
    accepted: requirement,
    payload: { quoteId, action, signature: signatureObject(signature), nonce: timestamp },
  };
}

class MemoryStore implements HypercorePaymentStore {
  private readonly values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, structuredClone(value)); }
  async transaction<T>(callback: () => Promise<T>): Promise<T> { return callback(); }
}

test('HyperCore usdSend verification binds the signed payee, amount, time, and quote', async () => {
  const quoteId = 'quote_0123456789abcdefghijklmnopqrstuv';
  const payment = await signedPayment(quoteId);
  const store = new MemoryStore();
  const coordinator = new HypercorePaymentCoordinator(store, { submit: async () => ({ status: 'ok', response: { type: 'default' } }) }, () => timestamp + 500);
  await coordinator.createQuote({ quoteId, merchantId: 'priorseal', resource: 'https://priorseal.example/v1/receipt', network: HYPERCORE_X402_MAINNET, amount: '0.02', payTo, maxTimeoutSeconds: 60 });

  const verified = await coordinator.verify(payment, 'priorseal');
  assert.equal(verified.isValid, true);
  if (verified.isValid) assert.equal(verified.payer, signer.address);

  const altered = structuredClone(payment);
  altered.payload.action.amount = '0.03';
  const invalid = await coordinator.verify(altered, 'priorseal');
  assert.deepEqual(invalid, { isValid: false, invalidReason: 'payment_mismatch' });
});

test('HyperCore coordinator settles exactly once and returns a deterministic receipt reference', async () => {
  const quoteId = 'quote_1123456789abcdefghijklmnopqrstuv';
  const payment = await signedPayment(quoteId);
  const store = new MemoryStore();
  let submissions = 0;
  const coordinator = new HypercorePaymentCoordinator(store, {
    submit: async () => {
      submissions += 1;
      return { status: 'ok', response: { type: 'default' } };
    },
  }, () => timestamp + 500);
  await coordinator.createQuote({ quoteId, merchantId: 'insight', resource: 'https://insight.example/api/v1/safety/pre-trade', network: HYPERCORE_X402_MAINNET, amount: '0.02', payTo, maxTimeoutSeconds: 60 });
  assert.equal((await coordinator.verify(payment, 'insight')).isValid, true);
  const first = await coordinator.settle(payment, 'insight');
  const second = await coordinator.settle(payment, 'insight');
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(first.transaction, second.transaction);
  assert.match(first.transaction, /^hcx_[0-9a-f]{32}$/);
  assert.equal(submissions, 1, 'an idempotent retry must not submit a second Core transfer');
});

test('HyperCore coordinator rejects replaying one signed action against a second quote or merchant', async () => {
  const firstQuote = 'quote_2123456789abcdefghijklmnopqrstuv';
  const secondQuote = 'quote_3123456789abcdefghijklmnopqrstuv';
  const firstPayment = await signedPayment(firstQuote);
  const replayedPayment = structuredClone(firstPayment);
  replayedPayment.accepted = createHypercorePaymentRequirement({ network: HYPERCORE_X402_MAINNET, amount: '0.02', payTo, quoteId: secondQuote, maxTimeoutSeconds: 60 });
  replayedPayment.payload.quoteId = secondQuote;
  const store = new MemoryStore();
  const coordinator = new HypercorePaymentCoordinator(store, { submit: async () => ({ status: 'ok', response: { type: 'default' } }) }, () => timestamp + 500);
  await coordinator.createQuote({ quoteId: firstQuote, merchantId: 'priorseal', resource: 'https://priorseal.example/v1/receipt', network: HYPERCORE_X402_MAINNET, amount: '0.02', payTo, maxTimeoutSeconds: 60 });
  await coordinator.createQuote({ quoteId: secondQuote, merchantId: 'priorseal', resource: 'https://priorseal.example/v1/receipt', network: HYPERCORE_X402_MAINNET, amount: '0.02', payTo, maxTimeoutSeconds: 60 });
  assert.equal((await coordinator.verify(firstPayment, 'priorseal')).isValid, true);
  assert.deepEqual(await coordinator.verify(replayedPayment, 'priorseal'), { isValid: false, invalidReason: 'replayed_action' });
  assert.deepEqual(await coordinator.verify(firstPayment, 'insight'), { isValid: false, invalidReason: 'merchant_mismatch' });
});

test('HyperCore timeout after broadcast is terminally pending and is never retried automatically', async () => {
  const quoteId = 'quote_4123456789abcdefghijklmnopqrstuv';
  const payment = await signedPayment(quoteId);
  const store = new MemoryStore();
  let submissions = 0;
  const coordinator = new HypercorePaymentCoordinator(store, {
    submit: async () => {
      submissions += 1;
      throw new Error('socket closed after submit');
    },
  }, () => timestamp + 500);
  await coordinator.createQuote({ quoteId, merchantId: 'priorseal', resource: 'https://priorseal.example/v1/receipt', network: HYPERCORE_X402_MAINNET, amount: '0.02', payTo, maxTimeoutSeconds: 60 });
  assert.equal((await coordinator.verify(payment, 'priorseal')).isValid, true);
  const first = await coordinator.settle(payment, 'priorseal');
  const second = await coordinator.settle(payment, 'priorseal');
  assert.equal(first.errorReason, 'settlement_pending');
  assert.equal(second.errorReason, 'settlement_pending');
  assert.equal(submissions, 1);
});
