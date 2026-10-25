import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntent } from '../../src/domain/intent.mjs';
import { bindIntentExecution } from '../../src/domain/binding.mjs';
import { authorizationTypedData, buildAuthorization, verifyAuthorization } from '../../src/domain/authorization.mjs';
import { evaluateIntentPolicy } from '../../src/domain/intent-policy.mjs';
import { privateKeyToAccount } from 'viem/accounts';

const account = `0x${'a'.repeat(40)}`;
const cloid = `0x${'b'.repeat(32)}`;
const evidence = {
  schema: 'priorseal.hyperliquid-info-observation.v1' as const,
  endpointHash: '1'.repeat(64), orderStatusRequestHash: '2'.repeat(64), orderStatusResponseHash: '3'.repeat(64),
  fillRequestHashes: ['4'.repeat(64)], fillResponseHashes: ['5'.repeat(64)], fillPageCount: 1, fillResponseCount: 1,
  relevantFillCount: 1, fillsComplete: true, observedAtMillis: 1_700_000_001_000,
};
const input = {
  schema: 'priorseal.intent.v2',
  executionProfile: 'priorseal.execution-profile.hyperliquid-spot-ioc.v1',
  intentId: 'hyperliquid-ioc-1',
  chainId: 0,
  chainRef: 'hyperliquid:mainnet',
  action: 'HYPERLIQUID_SPOT_IOC_ORDER',
  asset: 'hyperliquid:mainnet/spot:10001',
  amount: '2000000',
  sender: account,
  recipient: account,
  validUntil: 1_700_000_060,
  nonce: '1700000000000',
  hyperliquidOrder: { assetId: 10001, isBuy: true, limitPrice: '100.5000', size: '2.00', timeInForce: 'Ioc', clientOrderId: cloid.toUpperCase().replace('0X', '0x'), expiresAfter: 1_700_000_060_000 },
};

test('Hyperliquid spot IOC intent canonically binds cloid, expiry, and limit parameters', () => {
  const intent = buildIntent(input);
  assert.equal(intent.chainRef, 'hyperliquid:mainnet');
  assert.deepEqual(intent.hyperliquidOrder, { assetId: 10001, isBuy: true, limitPrice: '100.5', size: '2', timeInForce: 'Ioc', clientOrderId: cloid, expiresAfter: 1_700_000_060_000 });
  const execution = {
    chainId: 0, chainRef: 'hyperliquid:mainnet', status: 'CONFIRMED', finalityState: 'CONFIRMED', confirmations: 1,
    action: 'HYPERLIQUID_SPOT_IOC_ORDER', sender: account, recipient: account, asset: 'hyperliquid:mainnet/spot:10001', amount: '0', nonce: '1700000000000',
    executedAt: 1_700_000_001, observedAt: 1_700_000_001, executionDataAvailable: true,
    hyperliquidOrder: { ...intent.hyperliquidOrder!, orderId: '42', orderStatus: 'filled' as const, filledSize: '2', averagePrice: '99.5', fee: '0.1', statusTimestamp: 1_700_000_001_000 },
    hyperliquidInfoObservation: evidence,
  };
  assert.deepEqual(bindIntentExecution(intent, execution).reasonCodes, []);
  assert.deepEqual(bindIntentExecution(intent, { ...execution, hyperliquidOrder: { ...execution.hyperliquidOrder, averagePrice: '101' } }).reasonCodes, ['HYPERLIQUID_ORDER_MISMATCH']);
  assert.deepEqual(bindIntentExecution(intent, { ...execution, hyperliquidOrder: { ...execution.hyperliquidOrder, orderStatus: 'iocCancelRejected', filledSize: '0', averagePrice: null } }).reasonCodes, []);
  assert.deepEqual(bindIntentExecution(intent, { ...execution, hyperliquidInfoObservation: { ...evidence, fillsComplete: false } }).reasonCodes, ['EXECUTION_UNAVAILABLE']);
});

test('Hyperliquid IOC intent rejects unsupported chain fields and unobservable finality', () => {
  assert.throws(() => buildIntent({ ...input, callTarget: account }), { code: 'INVALID_INTENT' });
  assert.throws(() => buildIntent({ ...input, constraints: { finalityRequirement: 'RPC_FINALIZED' } }), { code: 'INVALID_CONSTRAINT' });
  assert.throws(() => buildIntent({ ...input, hyperliquidOrder: { ...input.hyperliquidOrder, clientOrderId: '0x1234' } }), { code: 'INVALID_HYPERLIQUID_ORDER' });
  assert.throws(() => buildIntent({ ...input, hyperliquidOrder: { ...input.hyperliquidOrder, expiresAfter: 1_700_001_000_000 } }), { code: 'INVALID_HYPERLIQUID_ORDER' });
  assert.throws(() => buildIntent({ ...input, asset: 'hyperliquid:mainnet/spot:100000000', hyperliquidOrder: { ...input.hyperliquidOrder, assetId: 100000000 } }), { code: 'INVALID_HYPERLIQUID_ORDER' });
});

test('Hyperliquid IOC intent uses the ordinary EIP-712 authorization boundary', async () => {
  const signer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const intent = buildIntent({ ...input, intentId: 'hyperliquid-eip712', sender: signer.address, recipient: signer.address });
  const draft = buildAuthorization({
    intent,
    principal: { type: 'user', id: 'trader-1', account: signer.address },
    authorizer: { type: 'eip712', address: signer.address },
    delegate: { agentId: 'trader-1', executor: signer.address },
    issuedAt: 1_700_000_000,
    notBefore: 1_700_000_000,
    expiresAt: 1_700_000_060,
    authorizationNonce: `0x${'c'.repeat(64)}`,
    maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}`,
  });
  const authorization = buildAuthorization({ ...draft, signature: await signer.signTypedData(authorizationTypedData(draft)) });
  assert.equal((await verifyAuthorization(authorization, { now: 1_700_000_001 })).valid, true);
});

test('Hyperliquid account policy matching retains EVM address case normalization', () => {
  const intent = buildIntent(input);
  assert.equal(evaluateIntentPolicy(intent, { allowedChainIds: ['hyperliquid:mainnet'], allowedActions: ['HYPERLIQUID_SPOT_IOC_ORDER'], allowedSenders: [account.toUpperCase()] }).allowed, true);
});
