import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { X402_EVM_NETWORKS, createX402PaymentService, parseX402Config } from '../../src/infrastructure/payments/x402-exact-evm.mjs';

const route = { method: 'GET' as const, path: '/v1/receipts/:receiptId/bundle', description: 'Export an evidence bundle', price: '$0.01' };
const payTo = `0x${'b'.repeat(40)}`;

const base = {
  PRIORSEAL_X402_FACILITATOR_URL: 'https://default.facilitator.test',
  PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://api.example.test',
  PRIORSEAL_X402_PAY_TO: payTo,
  PRIORSEAL_X402_ROUTES_JSON: JSON.stringify([route]),
};

function bnbNetwork() {
  const network = X402_EVM_NETWORKS.find((entry) => entry.network === 'eip155:56');
  assert.ok(network, 'eip155:56 must be a production payment rail');
  return network;
}

function hyperEvmNetwork() {
  const network = X402_EVM_NETWORKS.find((entry) => entry.network === 'eip155:999');
  assert.ok(network, 'eip155:999 must be a production payment rail');
  return network;
}

test('BNB Smart Chain mirrors the Insight-validated exact v2 rail', () => {
  const network = bnbNetwork();
  assert.equal(network.chainId, 56);
  assert.equal(network.name, 'BNB Smart Chain');
  assert.equal(network.asset, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d');
  assert.equal(network.assetName, 'USD Coin');
  assert.equal(network.assetVersion, '2');
  assert.equal(network.assetDecimals, 18);
  assert.equal(new Set(X402_EVM_NETWORKS.map((entry) => entry.network)).size, X402_EVM_NETWORKS.length);
});

test('HyperEVM uses Circle-native USDC on the ordinary 6-decimal grid', () => {
  const network = hyperEvmNetwork();
  assert.equal(network.chainId, 999);
  assert.equal(network.name, 'HyperEVM');
  assert.equal(network.asset, '0xb88339CB7199b77E23DB6E890353E22632Ba630f');
  assert.equal(network.assetName, 'USDC');
  assert.equal(network.assetVersion, '2');
  assert.equal('assetDecimals' in network, false);
  assert.equal(new Set(X402_EVM_NETWORKS.map((entry) => entry.network)).size, X402_EVM_NETWORKS.length);
});

test('BNB Smart Chain is advertised by default and on explicit selection', () => {
  const defaulted = parseX402Config(base);
  assert.ok(defaulted?.networks.includes('eip155:56'));
  assert.ok(defaulted?.networks.includes('eip155:999'));
  const explicit = parseX402Config({ ...base, PRIORSEAL_X402_NETWORKS: 'eip155:8453,eip155:56,eip155:999' });
  assert.deepEqual(explicit?.networks, ['eip155:8453', 'eip155:56', 'eip155:999']);
});

test('per-network facilitator overrides parse and validate strictly', () => {
  const parsed = parseX402Config({
    ...base,
    PRIORSEAL_X402_NETWORKS: 'eip155:8453,eip155:56',
    PRIORSEAL_X402_FACILITATOR_URLS: 'eip155:56=https://aeon.facilitator.test',
  });
  assert.deepEqual(parsed?.facilitatorUrls, { 'eip155:56': 'https://aeon.facilitator.test' });
  assert.throws(() => parseX402Config({ ...base, PRIORSEAL_X402_FACILITATOR_URLS: 'no-equals-sign' }), /network=url/);
  assert.throws(() => parseX402Config({ ...base, PRIORSEAL_X402_FACILITATOR_URLS: 'eip155:998=https://x.facilitator.test' }), /unsupported payment network/);
  assert.throws(() => parseX402Config({ ...base, PRIORSEAL_X402_FACILITATOR_URLS: 'eip155:56=https://a.facilitator.test,eip155:56=https://b.facilitator.test' }), /duplicate/);
  assert.throws(() => parseX402Config({ ...base, PRIORSEAL_X402_FACILITATOR_URLS: 'eip155:56=http://x.facilitator.test' }), /must be HTTPS/);
});

test('HyperEVM requirements use native-USDC units and route verification and settlement to its override', async (t) => {
  const config = parseX402Config({
    ...base,
    PRIORSEAL_X402_NETWORKS: 'eip155:999',
    PRIORSEAL_X402_FACILITATOR_URLS: 'eip155:999=https://hyperevm.facilitator.test',
  })!;
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    requested.push(url.toString());
    if (url.toString() === 'https://default.facilitator.test/supported') return Response.json({ kinds: [] });
    if (url.toString() === 'https://hyperevm.facilitator.test/supported') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:999' }] });
    if (url.toString() === 'https://hyperevm.facilitator.test/verify') return Response.json({ isValid: true });
    if (url.toString() === 'https://hyperevm.facilitator.test/settle') {
      const body = JSON.parse(String(init?.body)) as { paymentRequirements: { amount: string; asset: string; extra: Record<string, string> } };
      assert.equal(body.paymentRequirements.amount, '10000');
      assert.equal(body.paymentRequirements.asset, '0xb88339CB7199b77E23DB6E890353E22632Ba630f');
      assert.deepEqual(body.paymentRequirements.extra, { name: 'USDC', version: '2' });
      return Response.json({ success: true, transaction: `0x${'a'.repeat(64)}`, network: 'eip155:999', amount: body.paymentRequirements.amount });
    }
    throw new TypeError(`Unexpected facilitator request: ${url.toString()}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const service = createX402PaymentService(config);
  const resourceUrl = 'https://api.example.test/v1/receipts/probe/bundle';
  const required = await service.prepare(config.routes[0], resourceUrl, undefined);
  assert.equal(required.kind, 'required');
  if (required.kind !== 'required') return;
  const requirement = (required.response as { accepts: Array<Record<string, unknown>> }).accepts[0];
  assert.deepEqual(requirement, {
    scheme: 'exact', network: 'eip155:999', amount: '10000', asset: '0xb88339CB7199b77E23DB6E890353E22632Ba630f', payTo: config.payTo, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' },
  });
  assert.deepEqual(requested, ['https://hyperevm.facilitator.test/supported'], 'a HyperEVM-only rollout must not query an unrelated default facilitator');

  const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted: requirement, payload: {} }), 'utf8').toString('base64');
  requested.length = 0;
  const authorized = await service.prepare(config.routes[0], resourceUrl, header);
  assert.equal(authorized.kind, 'authorized');
  assert.deepEqual(requested, ['https://hyperevm.facilitator.test/verify']);
  if (authorized.kind !== 'authorized') return;
  requested.length = 0;
  const settled = await service.settle(authorized.context);
  assert.equal(settled.success, true);
  assert.deepEqual(requested, ['https://hyperevm.facilitator.test/settle']);
});

test('CDP authentication coexists with per-network overrides; the JWT stays on the CDP endpoint', async (t) => {
  const pair = generateKeyPairSync('ed25519');
  const privateJwk = pair.privateKey.export({ format: 'jwk' }) as JsonWebKey;
  const secret = Buffer.concat([Buffer.from(privateJwk.d!, 'base64url'), Buffer.from(privateJwk.x!, 'base64url')]).toString('base64');
  const config = parseX402Config({
    ...base,
    PRIORSEAL_X402_NETWORKS: 'eip155:8453,eip155:56',
    PRIORSEAL_X402_FACILITATOR_URL: 'https://api.cdp.coinbase.com/platform/v2/x402',
    PRIORSEAL_X402_FACILITATOR_AUTH_MODE: 'cdp',
    PRIORSEAL_X402_CDP_API_KEY_ID: 'organizations/example/apiKeys/key-1',
    PRIORSEAL_X402_CDP_API_KEY_SECRET: secret,
    PRIORSEAL_X402_FACILITATOR_URLS: 'eip155:56=https://aeon.facilitator.test',
  })!;
  const headersByUrl = new Map<string, Record<string, string>>();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    headersByUrl.set(url.toString(), {});
    const network = url.toString().includes('aeon.facilitator.test') ? 'eip155:56' : 'eip155:8453';
    return new Response(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network }] }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const service = createX402PaymentService(config);
  await service.prepare(config.routes[0], 'https://api.example.test/v1/receipts/probe/bundle', undefined);
  assert.ok(headersByUrl.has('https://aeon.facilitator.test/supported'), 'override facilitator must be queried');
  assert.ok(headersByUrl.has('https://api.cdp.coinbase.com/platform/v2/x402/supported'), 'CDP facilitator must be queried');
});

test('BNB requirements use 18-decimal amounts and route to the override facilitator', async (t) => {
  const config = parseX402Config({
    ...base,
    PRIORSEAL_X402_NETWORKS: 'eip155:8453,eip155:56',
    PRIORSEAL_X402_FACILITATOR_URLS: 'eip155:56=https://aeon.facilitator.test',
  })!;
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    requested.push(url.toString());
    if (url.toString() === 'https://default.facilitator.test/supported') {
      return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }] });
    }
    if (url.toString() === 'https://aeon.facilitator.test/supported') {
      return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:56' }] });
    }
    if (url.toString() === 'https://aeon.facilitator.test/verify') {
      return Response.json({ isValid: true });
    }
    if (url.toString() === 'https://aeon.facilitator.test/settle') {
      const body = JSON.parse(String(init?.body)) as { paymentRequirements: { amount: string } };
      return Response.json({ success: true, transaction: `0x${'a'.repeat(64)}`, network: 'eip155:56', amount: body.paymentRequirements.amount });
    }
    throw new TypeError(`Unexpected facilitator request: ${url.toString()}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const service = createX402PaymentService(config);
  const resourceUrl = 'https://api.example.test/v1/receipts/probe/bundle';
  const required = await service.prepare(config.routes[0], resourceUrl, undefined);
  assert.equal(required.kind, 'required');
  if (required.kind !== 'required') return;
  const accepts = (required.response as { accepts: Array<Record<string, unknown>> }).accepts;
  const bnb = accepts.find((entry) => entry.network === 'eip155:56');
  assert.ok(bnb, 'BNB requirement must be advertised');
  assert.equal(bnb.asset, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d');
  assert.equal(bnb.amount, '10000000000000000', '$0.01 must scale to 18 decimals');
  assert.deepEqual(bnb.extra, { name: 'USD Coin', version: '2' });
  const baseEntry = accepts.find((entry) => entry.network === 'eip155:8453');
  assert.equal(baseEntry?.amount, '10000', '6-decimal rails keep the micro-USDC grid');
  const discovered = (expected: string): boolean => requested.some((entry) => entry === expected);
  assert.ok(discovered('https://aeon.facilitator.test/supported'), 'BNB discovery must hit the override facilitator');
  assert.ok(discovered('https://default.facilitator.test/supported'), 'Base discovery must hit the default facilitator');

  const payment = { x402Version: 2 as const, accepted: bnb as never, payload: {} };
  const header = Buffer.from(JSON.stringify(payment), 'utf8').toString('base64');
  requested.length = 0;
  const authorized = await service.prepare(config.routes[0], resourceUrl, header);
  assert.equal(authorized.kind, 'authorized');
  assert.deepEqual(requested, ['https://aeon.facilitator.test/verify'], 'BNB verification must route to the override facilitator');
  if (authorized.kind !== 'authorized') return;

  requested.length = 0;
  const settled = await service.settle(authorized.context);
  assert.equal(settled.success, true);
  assert.deepEqual(requested, ['https://aeon.facilitator.test/settle'], 'BNB settlement must route to the override facilitator');
});
