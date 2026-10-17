import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { CDP_X402_FACILITATOR_URL } from '../../src/infrastructure/payments/cdp-facilitator-auth.mjs';
import { createX402PaymentService, parseX402Config } from '../../src/infrastructure/payments/x402-exact-evm.mjs';

const route = { method: 'GET' as const, path: '/v1/receipts/:receiptId/bundle', description: 'Export an evidence bundle', price: '$0.01' };
const payTo = `0x${'b'.repeat(40)}`;

function cdpSecret() {
  const pair = generateKeyPairSync('ed25519');
  const privateJwk = pair.privateKey.export({ format: 'jwk' }) as JsonWebKey;
  const secret = Buffer.concat([Buffer.from(privateJwk.d!, 'base64url'), Buffer.from(privateJwk.x!, 'base64url')]).toString('base64');
  return { secret, publicJwk: pair.publicKey.export({ format: 'jwk' }) as JsonWebKey };
}

test('CDP facilitator mode creates an endpoint-bound Ed25519 JWT for discovery', async (t) => {
  const { secret, publicJwk } = cdpSecret();
  const config = parseX402Config({
    PRIORSEAL_X402_FACILITATOR_URL: CDP_X402_FACILITATOR_URL,
    PRIORSEAL_X402_FACILITATOR_AUTH_MODE: 'cdp',
    PRIORSEAL_X402_CDP_API_KEY_ID: 'organizations/example/apiKeys/key-1',
    PRIORSEAL_X402_CDP_API_KEY_SECRET: secret,
    PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://api.example.test',
    PRIORSEAL_X402_PAY_TO: payTo,
    PRIORSEAL_X402_NETWORKS: 'eip155:8453',
    PRIORSEAL_X402_ROUTES_JSON: JSON.stringify([route]),
  });
  assert.equal(config?.facilitatorAuth?.provider, 'cdp');
  assert.equal(config?.facilitatorHeaders.supported, undefined);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    assert.equal(url.toString(), `${CDP_X402_FACILITATOR_URL}/supported`);
    assert.equal(init?.method, 'GET');
    const authorization = new Headers(init?.headers).get('authorization');
    if (!authorization) throw new TypeError('CDP discovery request is missing Authorization');
    assert.ok(authorization.startsWith('Bearer '));
    assert.equal(authorization.includes(secret), false);
    const [headerPart, payloadPart, signaturePart] = authorization.slice('Bearer '.length).split('.');
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as Record<string, unknown>;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
    assert.deepEqual(header.alg, 'EdDSA');
    assert.deepEqual(header.kid, 'organizations/example/apiKeys/key-1');
    assert.match(String(header.nonce), /^[0-9a-f]{32}$/);
    assert.deepEqual(payload.uris, [`GET api.cdp.coinbase.com/platform/v2/x402/supported`]);
    assert.equal(payload.iss, 'cdp');
    assert.equal(payload.sub, 'organizations/example/apiKeys/key-1');
    assert.equal(Number(payload.exp) - Number(payload.iat), 120);
    const verifyKey = await crypto.subtle.importKey('jwk', publicJwk, 'Ed25519', false, ['verify']);
    assert.equal(await crypto.subtle.verify('Ed25519', verifyKey, Buffer.from(signaturePart, 'base64url'), Buffer.from(`${headerPart}.${payloadPart}`)), true);
    return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }] });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await createX402PaymentService(config!).prepare(config!.routes[0], 'https://api.example.test/v1/receipts/probe/bundle', undefined);
  assert.equal(result.kind, 'required');
});

test('CDP facilitator mode fails closed on missing, mixed, or mismatched credentials', () => {
  const { secret } = cdpSecret();
  const base = {
    PRIORSEAL_X402_FACILITATOR_URL: CDP_X402_FACILITATOR_URL,
    PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://api.example.test',
    PRIORSEAL_X402_PAY_TO: payTo,
    PRIORSEAL_X402_NETWORKS: 'eip155:8453',
    PRIORSEAL_X402_ROUTES_JSON: JSON.stringify([route]),
    PRIORSEAL_X402_FACILITATOR_AUTH_MODE: 'cdp',
  };
  assert.throws(() => parseX402Config(base), /CDP_API_KEY_ID/);
  assert.throws(() => parseX402Config({ ...base, PRIORSEAL_X402_CDP_API_KEY_ID: 'key-1', PRIORSEAL_X402_CDP_API_KEY_SECRET: secret, PRIORSEAL_X402_FACILITATOR_URL: 'https://facilitator.example' }), /requires https:\/\/api\.cdp\.coinbase\.com/);
  assert.throws(() => parseX402Config({ ...base, PRIORSEAL_X402_CDP_API_KEY_ID: 'key-1', PRIORSEAL_X402_CDP_API_KEY_SECRET: secret, PRIORSEAL_X402_FACILITATOR_HEADERS_JSON: '{"supported":{"Authorization":"Bearer test"}}' }), /cannot be combined/);
  assert.throws(() => parseX402Config({ ...base, PRIORSEAL_X402_CDP_API_KEY_ID: 'key-1', PRIORSEAL_X402_CDP_API_KEY_SECRET: secret, PRIORSEAL_X402_FACILITATOR_HEADERS_JSON: '{}' }), /cannot be combined/);
  assert.throws(() => parseX402Config({ ...base, PRIORSEAL_X402_CDP_API_KEY_ID: 'key-1', PRIORSEAL_X402_CDP_API_KEY_SECRET: Buffer.alloc(63).toString('base64') }), /64-byte Ed25519/);
  assert.throws(() => parseX402Config({ ...base, PRIORSEAL_X402_FACILITATOR_AUTH_MODE: undefined, PRIORSEAL_X402_CDP_API_KEY_ID: 'key-1', PRIORSEAL_X402_CDP_API_KEY_SECRET: secret }), /require PRIORSEAL_X402_FACILITATOR_AUTH_MODE/);
});
