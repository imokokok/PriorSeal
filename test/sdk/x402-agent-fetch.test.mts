import test from 'node:test';
import assert from 'node:assert/strict';
import { createX402AgentFetch } from '../../sdk/dist/index.js';

const requirement = {
  scheme: 'exact' as const,
  network: 'eip155:8453',
  amount: '10000',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x1111111111111111111111111111111111111111',
  maxTimeoutSeconds: 300,
  extra: { name: 'USD Coin', version: '2' },
};

function header(value: unknown) { return btoa(JSON.stringify(value)); }

test('agent x402 transport pays one policy-approved receipt-bundle challenge', async () => {
  const challenge = { x402Version: 2, resource: { url: 'https://priorseal.test/v1/receipts/psr_test/bundle', description: 'Receipt bundle' }, accepts: [requirement] };
  const signature = header({ x402Version: 2, accepted: requirement, payload: { authorization: 'opaque' } });
  const calls: Request[] = [];
  let signerCalls = 0;
  const paidFetch = createX402AgentFetch({
    fetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return request.headers.has('payment-signature')
        ? new Response('{"delivered":true}', { headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify(challenge), { status: 402, headers: { 'payment-required': header(challenge) } });
    },
    signer: async ({ request, allowedRequirements }) => {
      signerCalls += 1;
      assert.equal(request.url, challenge.resource.url);
      assert.deepEqual(allowedRequirements, [requirement]);
      return signature;
    },
    policy: {
      allowedOrigins: ['https://priorseal.test'],
      allowPath: pathname => /^\/v1\/receipts\/[^/]+\/bundle$/.test(pathname),
      maxAmountAtomic: '10000',
      allowedNetworks: ['eip155:8453'],
      allowedAssets: [requirement.asset],
      allowedPayTos: [requirement.payTo],
    },
  });
  const response = await paidFetch(challenge.resource.url);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"delivered":true}');
  assert.equal(signerCalls, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.headers.has('payment-signature'), false);
  assert.equal(calls[1]?.headers.get('payment-signature'), signature);
});

test('agent x402 transport refuses a challenge over its configured spend limit', async () => {
  const challenge = { x402Version: 2, resource: { url: 'https://priorseal.test/v1/receipts/psr_test/bundle' }, accepts: [{ ...requirement, amount: '10001' }] };
  let signerCalls = 0;
  const paidFetch = createX402AgentFetch({
    fetch: async () => new Response(JSON.stringify(challenge), { status: 402, headers: { 'payment-required': header(challenge) } }),
    signer: async () => { signerCalls += 1; return header({ x402Version: 2, accepted: requirement, payload: {} }); },
    policy: { allowedOrigins: ['https://priorseal.test'], allowPath: pathname => pathname.endsWith('/bundle'), maxAmountAtomic: '10000' },
  });
  await assert.rejects(paidFetch(challenge.resource.url), /No x402 payment requirement/);
  assert.equal(signerCalls, 0);
});

test('agent x402 transport never pays a POST request', async () => {
  let signerCalls = 0;
  const paidFetch = createX402AgentFetch({
    fetch: async () => new Response('payment required', { status: 402 }),
    signer: async () => { signerCalls += 1; return ''; },
    policy: { allowedOrigins: ['https://priorseal.test'], allowPath: () => true, maxAmountAtomic: '1' },
  });
  const response = await paidFetch('https://priorseal.test/v1/authorizations', { method: 'POST', body: '{}' });
  assert.equal(response.status, 402);
  assert.equal(signerCalls, 0);
});
