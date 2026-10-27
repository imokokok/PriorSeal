import test from 'node:test';
import assert from 'node:assert/strict';
import { agentCredentialHash, createAgentMeter, parseAgentMeterConfig } from '../../src/application/commerce/agent-meter.mjs';
import { parseX402CreditPacks, x402CreditPurchaseId } from '../../src/application/commerce/x402-credit-packs.mjs';
import { createMemoryStore } from '../../src/infrastructure/persistence/memory-store.mjs';
import { parseX402Config } from '../../src/infrastructure/payments/x402-exact-evm.mjs';

const secret = 'agent-secret-that-is-long-enough-for-a-production-boundary';
const config = parseAgentMeterConfig({
  schema: 'priorseal.agent-meter.v1',
  creditUnitUsd: '0.01',
  operatorCredentialHash: agentCredentialHash('operator-secret-that-is-long-enough-for-a-commercial-service-boundary'),
  accounts: [{ accountId: 'team:alpha', credentialHash: agentCredentialHash(secret), provisionedCredits: '2', status: 'active' }],
  routes: [{ routeId: 'prepare', method: 'POST', path: '/v1/authorizations/prepare', credits: '1' }],
});

test('agent meter publishes exact decimal credit prices and rejects incomplete price configuration', () => {
  assert.equal(config?.creditUnitUsd, '0.01');
  assert.equal(config?.routes[0]?.priceUsd, '0.01');
  assert.throws(() => parseAgentMeterConfig({
    schema: 'priorseal.agent-meter.v1', operatorCredentialHash: agentCredentialHash('operator-secret-that-is-long-enough-for-a-commercial-service-boundary'), accounts: [], routes: [],
  }));
  assert.throws(() => parseAgentMeterConfig({
    schema: 'priorseal.agent-meter.v1', creditUnitUsd: '0.0100001', operatorCredentialHash: agentCredentialHash('operator-secret-that-is-long-enough-for-a-commercial-service-boundary'), accounts: [], routes: [],
  }));
});

test('agent meter reserves idempotently, releases failed calls and stops exhausted agents', async () => {
  const meter = createAgentMeter(config, createMemoryStore());
  assert.ok(meter);
  const first = await meter.authorize({ method: 'POST', pathname: '/v1/authorizations/prepare', credential: secret, requestKey: 'agent-call-1', now: 1000 });
  assert.ok(first);
  const replay = await meter.authorize({ method: 'POST', pathname: '/v1/authorizations/prepare', credential: secret, requestKey: 'agent-call-1', now: 1001 });
  assert.equal(replay?.reservation.usageId, first.reservation.usageId);
  assert.equal((await meter.settle(first.reservation, 'RELEASED'))?.state, 'RELEASED');
  const second = await meter.authorize({ method: 'POST', pathname: '/v1/authorizations/prepare', credential: secret, requestKey: 'agent-call-2', now: 1002 });
  assert.ok(second);
  assert.equal((await meter.settle(second.reservation, 'CONSUMED'))?.state, 'CONSUMED');
  const third = await meter.authorize({ method: 'POST', pathname: '/v1/authorizations/prepare', credential: secret, requestKey: 'agent-call-3', now: 1003 });
  assert.ok(third);
  await meter.settle(third.reservation, 'CONSUMED');
  await assert.rejects(meter.authorize({ method: 'POST', pathname: '/v1/authorizations/prepare', credential: secret, requestKey: 'agent-call-4', now: 1004 }), { code: 'AGENT_CREDITS_EXHAUSTED' });
});

test('agent meter rejects uncredentialed calls and leaves unrelated routes alone', async () => {
  const meter = createAgentMeter(config, createMemoryStore());
  assert.ok(meter);
  assert.equal(await meter.authorize({ method: 'GET', pathname: '/health/live', credential: undefined, requestKey: undefined, now: 1000 }), null);
  await assert.rejects(meter.authorize({ method: 'POST', pathname: '/v1/authorizations/prepare', credential: undefined, requestKey: 'agent-call-1', now: 1000 }), { code: 'AGENT_CREDENTIAL_REQUIRED' });
});

test('operator-issued accounts can be inspected, topped up, and revoked without configuration overwriting revocation', async () => {
  const operatorSecret = 'operator-secret-that-is-long-enough-for-a-commercial-service-boundary';
  const meter = createAgentMeter(parseAgentMeterConfig({
    schema: 'priorseal.agent-meter.v1',
    creditUnitUsd: '0.01',
    operatorCredentialHash: agentCredentialHash(operatorSecret),
    accounts: [{ accountId: 'team:bootstrap', credentialHash: agentCredentialHash(secret), provisionedCredits: '1', status: 'active' }],
    routes: [{ routeId: 'prepare', method: 'POST', path: '/v1/authorizations/prepare', credits: '1' }],
  }), createMemoryStore());
  assert.ok(meter);
  const issued = await meter.operator.issue({ operatorCredential: operatorSecret, accountId: 'team:issued', provisionedCredits: '2' });
  assert.match(issued.credential, /^psa_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await meter.inspect(issued.credential), issued.account);
  const credited = await meter.operator.credit({ operatorCredential: operatorSecret, accountId: 'team:issued', credits: '3', requestKey: 'credit-1', reference: 'invoice:1', now: 1000 });
  assert.equal(credited.replay, false);
  assert.equal(credited.account.remainingCredits, '5');
  assert.equal(credited.operation.reference, 'invoice:1');
  const replayedCredit = await meter.operator.credit({ operatorCredential: operatorSecret, accountId: 'team:issued', credits: '3', requestKey: 'credit-1', reference: 'invoice:1', now: 1001 });
  assert.equal(replayedCredit.replay, true);
  assert.equal(replayedCredit.account.remainingCredits, '5');
  await assert.rejects(meter.operator.credit({ operatorCredential: operatorSecret, accountId: 'team:issued', credits: '3', requestKey: undefined, reference: null, now: 1001 }), { code: 'AGENT_IDEMPOTENCY_REQUIRED' });
  await assert.rejects(meter.operator.credit({ operatorCredential: operatorSecret, accountId: 'team:issued', credits: '4', requestKey: 'credit-1', reference: 'invoice:1', now: 1001 }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(meter.operator.issue({ operatorCredential: operatorSecret, accountId: 'team:issued', provisionedCredits: '1' }), { code: 'AGENT_ACCOUNT_EXISTS' });
  assert.equal((await meter.operator.revoke({ operatorCredential: operatorSecret, accountId: 'team:issued' })).status, 'revoked');
  await assert.rejects(meter.inspect(issued.credential), { code: 'AGENT_CREDENTIAL_INVALID' });
  await meter.authorize({ method: 'POST', pathname: '/v1/authorizations/prepare', credential: secret, requestKey: 'bootstrap-call-1', now: 1000 });
  await meter.operator.revoke({ operatorCredential: operatorSecret, accountId: 'team:bootstrap' });
  await assert.rejects(meter.authorize({ method: 'POST', pathname: '/v1/authorizations/prepare', credential: secret, requestKey: 'bootstrap-call-2', now: 1001 }), { code: 'AGENT_CREDENTIAL_INVALID' });
});

test('x402 checkout tops up a fixed credit pack exactly once and never turns a payment into signing authority', async () => {
  const x402 = parseX402Config({
    PRIORSEAL_X402_FACILITATOR_URL: 'https://facilitator.example.test',
    PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://api.example.test',
    PRIORSEAL_X402_PAY_TO: `0x${'b'.repeat(40)}`,
    PRIORSEAL_X402_ROUTES_JSON: JSON.stringify([{ method: 'GET', path: '/v1/agent-credit-packs/standard-100/checkout', description: 'Buy 100 Agent credits', price: '$1.00' }]),
  });
  assert.ok(x402);
  const packs = parseX402CreditPacks({ schema: 'priorseal.x402-credit-packs.v1', packs: [{ packId: 'standard-100', credits: '100', priceUsd: '1.00' }] }, x402);
  assert.ok(packs);
  assert.throws(() => parseX402CreditPacks({ schema: 'priorseal.x402-credit-packs.v1', packs: [{ packId: 'standard-100', credits: '100', priceUsd: '0.99' }] }, x402));

  const meter = createAgentMeter(config, createMemoryStore());
  assert.ok(meter);
  const paymentLedgerId = 'xpl_0123456789abcdef0123456789abcdef';
  const purchaseId = x402CreditPurchaseId(paymentLedgerId);
  const purchase = await meter.commerce.authorizeX402CreditPack({
    credential: secret, purchaseId, paymentLedgerId, packId: 'standard-100', credits: '100', priceUsd: '1.00', resourceUrl: 'https://api.example.test/v1/agent-credit-packs/standard-100/checkout', authorizedAt: 1_000,
  });
  assert.equal(purchase.state, 'AUTHORIZED');
  const settled = await meter.commerce.settleX402CreditPack({ purchaseId, settledAt: 1_100, settlementNetwork: 'eip155:8453', settlementTransaction: `0x${'1'.repeat(64)}` });
  assert.equal(settled.purchase.state, 'CREDITED');
  assert.equal(settled.account.remainingCredits, '102');
  const replay = await meter.commerce.settleX402CreditPack({ purchaseId, settledAt: 1_200, settlementNetwork: 'eip155:8453', settlementTransaction: `0x${'2'.repeat(64)}` });
  assert.equal(replay.account.remainingCredits, '102');
  assert.equal((await meter.commerce.getX402CreditPackPurchase({ credential: secret, purchaseId })).settlementTransaction, `0x${'1'.repeat(64)}`);
});
