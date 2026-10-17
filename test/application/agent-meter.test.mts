import test from 'node:test';
import assert from 'node:assert/strict';
import { agentCredentialHash, createAgentMeter, parseAgentMeterConfig } from '../../src/application/commerce/agent-meter.mjs';
import { createMemoryStore } from '../../src/infrastructure/persistence/memory-store.mjs';

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
