import test from 'node:test';
import assert from 'node:assert/strict';
import { PriorSealApiError, createPriorSealClient, generateAuthorizationNonce } from '../../sdk/dist/index.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('SDK maps typed methods to the PriorSeal API and sends stable idempotency keys', async () => {
  const calls = [];
  const client = createPriorSealClient({ baseUrl: 'https://priorseal.test/', idempotencyKey: () => 'idem-fixed', fetch: async (url, init) => {
    calls.push({ url, init });
    return response({ observation: { chainId: 8453, txHash: '0x1', status: 'PENDING' }, receipt: null });
  } });
  const result = await client.observeExecution({ authorizationId: 'auth_1', chainId: 8453, txHash: '0x1' });
  assert.equal(result.observation.status, 'PENDING');
  assert.equal(calls[0].url, 'https://priorseal.test/v1/executions/observe');
  assert.equal(new Headers(calls[0].init.headers).get('idempotency-key'), 'idem-fixed');
  assert.deepEqual(JSON.parse(calls[0].init.body), { authorizationId: 'auth_1', chainId: 8453, txHash: '0x1', confirmations: 0 });
});

test('SDK binds the browser global fetch implementation', async () => {
  const originalFetch = globalThis.fetch;
  let receiver;
  globalThis.fetch = async function () {
    receiver = this;
    return response({ status: 'ok' });
  };
  try {
    const client = createPriorSealClient();
    assert.equal((await client.health()).status, 'ok');
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SDK retrieves transparency evidence and observation jobs from encoded paths', async () => {
  const paths = [];
  const client = createPriorSealClient({ fetch: async (url) => {
    paths.push(String(url));
    return paths.length === 1
      ? response({ checkpoint: { size: 1 }, chain: [] })
      : response({ jobId: 'job/1', state: 'QUEUED', attempts: 0, input: {}, observation: null, error: null });
  } });
  await client.getTransparencyEvidence('auth/1');
  const job = await client.getObservationJob('job/1');
  assert.equal(job.state, 'QUEUED');
  assert.deepEqual(paths, ['/v1/authorizations/auth%2F1/transparency', '/v1/observation-jobs/job%2F1']);
});

test('SDK exposes structured API errors without losing server codes', async () => {
  const client = createPriorSealClient({ fetch: async () => response({ error: { code: 'AUTHORIZATION_EXPIRED', message: 'Expired', details: { at: 10 } } }, 410) });
  await assert.rejects(() => client.getAuthorization('auth_expired'), (error) => error instanceof PriorSealApiError && error.code === 'AUTHORIZATION_EXPIRED' && error.status === 410 && error.details.at === 10);
});

test('SDK wallet helper prepares, signs and accepts an authorization', async () => {
  const account = `0x${'a'.repeat(40)}`;
  const authorization = { schema: 'priorseal.authorization.v2', domain: 'priorseal/authorization/v2', authorizationId: 'auth_1', intent: { intentId: 'intent_1', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender: account, recipient: `0x${'b'.repeat(40)}`, validUntil: 2_000 }, intentHash: '1'.repeat(64), principal: { type: 'user', id: 'user:1', account }, authorizer: { type: 'eip712', address: account }, delegate: { agentId: 'agent:1', executor: account }, issuedAt: 1_000, notBefore: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'1'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}` };
  const requests = [];
  const client = createPriorSealClient({ fetch: async (url, init) => {
    requests.push({ url, body: init?.body && JSON.parse(init.body) });
    if (String(url).endsWith('/prepare')) return response({ authorization, typedData: { domain: { name: 'PriorSeal' } } });
    return response({ authorization: { ...authorization, signature: '0xsigned' }, acceptance: { authorizationId: 'auth_1' }, policy: { allowed: true, reasonCodes: [], policyId: null } }, 201);
  } });
  const provider = { async request({ method }) { return method === 'eth_requestAccounts' ? [account] : '0xsigned'; } };
  const flow = await client.authorizeWithWallet({ intent: authorization.intent, principal: { type: 'user', id: 'user:1' }, delegate: authorization.delegate, issuedAt: 1_000, authorizationNonce: authorization.authorizationNonce }, provider);
  assert.equal(flow.account, account);
  assert.equal(flow.signature, '0xsigned');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.signature, '0xsigned');
  assert.match(generateAuthorizationNonce(), /^0x[0-9a-f]{64}$/);
});
