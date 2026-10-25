import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { buildHyperliquidSpotIocIntent, buildHyperliquidSpotIocSubmission } from '../../sdk/dist/index.js';
import { verifyReceiptLocally } from '../../sdk/dist/verifier.js';
import { authorizationTypedData, authorizeIntent, buildAuthorization, buildAuthorizedReceipt, createMemoryStore } from '../../src/index.mjs';
import { signReceipt } from '../../src/domain/receipt.mjs';

const account = `0x${'a'.repeat(40)}`;

test('SDK builds a canonical Hyperliquid spot IOC intent without exchange credentials', () => {
  const intent = buildHyperliquidSpotIocIntent({
    intentId: 'sdk-hyperliquid-ioc', account, amount: '1000000', assetId: 10001, isBuy: false,
    limitPrice: '100.000', size: '1.5000', clientOrderId: `0x${'B'.repeat(32)}`,
    nonce: '1700000000000', expiresAfter: 1_700_000_060_000, validUntil: 1_700_000_060,
  });
  assert.equal(intent.executionProfile, 'priorseal.execution-profile.hyperliquid-spot-ioc.v1');
  assert.equal(intent.asset, 'hyperliquid:mainnet/spot:10001');
  assert.deepEqual(intent.hyperliquidOrder, { assetId: 10001, isBuy: false, limitPrice: '100', size: '1.5', timeInForce: 'Ioc', clientOrderId: `0x${'b'.repeat(32)}`, expiresAfter: 1_700_000_060_000 });
});

test('SDK refuses an IOC intent that claims EVM finalized observation', () => {
  assert.throws(() => buildHyperliquidSpotIocIntent({
    intentId: 'sdk-hyperliquid-invalid', account, amount: '1', assetId: 10001, isBuy: true,
    limitPrice: '1', size: '1', clientOrderId: `0x${'c'.repeat(32)}`,
    nonce: '1700000000000', expiresAfter: 1_700_000_060_000, validUntil: 1_700_000_060,
    constraints: { finalityRequirement: 'RPC_FINALIZED' },
  }), /confirmed observation/);
});

test('SDK emits the exact unsigned Hyperliquid action without gaining signing or transport authority', () => {
  const intent = buildHyperliquidSpotIocIntent({
    intentId: 'sdk-hyperliquid-submission', account, amount: '1', assetId: 10001, isBuy: true,
    limitPrice: '100', size: '2', clientOrderId: `0x${'c'.repeat(32)}`,
    nonce: '1700000000000', expiresAfter: 1_700_000_060_000, validUntil: 1_700_000_060,
  });
  assert.deepEqual(buildHyperliquidSpotIocSubmission(intent), {
    schema: 'priorseal.hyperliquid-spot-ioc-submission.v1', account, clientOrderId: `0x${'c'.repeat(32)}`,
    nonce: 1_700_000_000_000, expiresAfter: 1_700_000_060_000,
    action: { type: 'order', grouping: 'na', orders: [{ a: 10001, b: true, p: '100', s: '2', r: false, t: { limit: { tif: 'Ioc' } }, c: `0x${'c'.repeat(32)}` }] },
  });
});

test('SDK offline verifier reproduces a signed Hyperliquid spot IOC receipt', async () => {
  const signer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const intent = buildHyperliquidSpotIocIntent({
    intentId: 'sdk-hyperliquid-receipt', account: signer.address, amount: '1000000', assetId: 10001, isBuy: true,
    limitPrice: '100', size: '2', clientOrderId: `0x${'d'.repeat(32)}`,
    nonce: '1700000000000', expiresAfter: 1_700_000_060_000, validUntil: 1_700_000_060,
  });
  const draft = buildAuthorization({
    intent, principal: { type: 'user', id: 'trader-1', account: signer.address }, authorizer: { type: 'eip712', address: signer.address },
    delegate: { agentId: 'trader-1', executor: signer.address }, issuedAt: 1_700_000_000, notBefore: 1_700_000_000, expiresAt: 1_700_000_060,
    authorizationNonce: `0x${'e'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}`,
  });
  const authorization = buildAuthorization({ ...draft, signature: await signer.signTypedData(authorizationTypedData(draft)) });
  const keys = generateKeyPairSync('ed25519');
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const accepted = await authorizeIntent({ input: authorization, store: createMemoryStore({ clock: () => 1_700_000_001_000 }), privateKeyPem: privateKey, issuer: 'test', keyId: 'key-1', now: () => 1_700_000_001_000 });
  const execution = {
    chainId: 0, chainRef: 'hyperliquid:mainnet', txHash: intent.hyperliquidOrder!.clientOrderId, status: 'CONFIRMED' as const,
    action: 'HYPERLIQUID_SPOT_IOC_ORDER', sender: signer.address, recipient: signer.address, asset: intent.asset, amount: '0', nonce: intent.nonce,
    executedAt: 1_700_000_002, observedAt: 1_700_000_002, confirmations: 1, finalityState: 'CONFIRMED', transfers: [],
    hyperliquidOrder: { ...intent.hyperliquidOrder!, orderId: '7', orderStatus: 'filled' as const, filledSize: '2', averagePrice: '99.5', fee: '0.1', statusTimestamp: 1_700_000_002_000 },
    hyperliquidInfoObservation: { schema: 'priorseal.hyperliquid-info-observation.v1' as const, endpointHash: '1'.repeat(64), orderStatusRequestHash: '2'.repeat(64), orderStatusResponseHash: '3'.repeat(64), fillRequestHashes: ['4'.repeat(64)], fillResponseHashes: ['5'.repeat(64)], fillPageCount: 1, fillResponseCount: 1, relevantFillCount: 1, fillsComplete: true, observedAtMillis: 1_700_000_002_000 },
  };
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence, execution, issuer: 'test', keyId: 'key-1', issuedAt: 1_700_000_002 }), privateKey);
  const result = await verifyReceiptLocally(receipt, { trustedKeys: { issuer: 'test', keyId: 'key-1', algorithm: 'Ed25519', publicKey, status: 'active', validFrom: null, validUntil: null }, now: 1_700_000_003 });
  assert.equal(result.valid, true, result.code);
});

test('authorization persistence reserves a Hyperliquid cloid once per account', async () => {
  const signer = privateKeyToAccount(`0x${'2'.repeat(64)}`);
  const keys = generateKeyPairSync('ed25519');
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const store = createMemoryStore({ clock: () => 1_700_000_001_000 });
  const makeAuthorization = async (intentId: string, nonce: string) => {
    const intent = buildHyperliquidSpotIocIntent({ intentId, account: signer.address, amount: '1', assetId: 10001, isBuy: true, limitPrice: '10', size: '1', clientOrderId: `0x${'f'.repeat(32)}`, nonce: '1700000000000', expiresAfter: 1_700_000_060_000, validUntil: 1_700_000_060 });
    const draft = buildAuthorization({ intent, principal: { type: 'user', id: 'trader-2', account: signer.address }, authorizer: { type: 'eip712', address: signer.address }, delegate: { agentId: 'trader-2', executor: signer.address }, issuedAt: 1_700_000_000, notBefore: 1_700_000_000, expiresAt: 1_700_000_060, authorizationNonce: nonce, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}` });
    return buildAuthorization({ ...draft, signature: await signer.signTypedData(authorizationTypedData(draft)) });
  };
  await authorizeIntent({ input: await makeAuthorization('sdk-hyperliquid-reservation-a', `0x${'a'.repeat(64)}`), store, privateKeyPem: privateKey, issuer: 'test', keyId: 'key-1', now: () => 1_700_000_001_000 });
  const second = await makeAuthorization('sdk-hyperliquid-reservation-b', `0x${'b'.repeat(64)}`);
  await assert.rejects(() => authorizeIntent({ input: second, store, privateKeyPem: privateKey, issuer: 'test', keyId: 'key-1', now: () => 1_700_000_001_000 }), { code: 'HYPERLIQUID_CLOID_ALREADY_AUTHORIZED' });
});
