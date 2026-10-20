import test from 'node:test';
import assert from 'node:assert/strict';
import { runX402ProductionReadiness } from '../../scripts/x402-production-readiness.mjs';

const payTo = '0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231';
const asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const origin = 'https://priorseal.example';
const path = '/v1/receipts/:receiptId/bundle';
const probeUrl = `${origin}/v1/receipts/x402-production-probe/bundle`;
const requirement = { scheme: 'exact', network: 'eip155:8453', amount: '10000', asset, payTo, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } };
const challenge = { x402Version: 2, error: 'Payment required', resource: { url: probeUrl, description: 'Export a portable receipt bundle', mimeType: 'application/json', serviceName: 'PriorSeal' }, accepts: [requirement] };
const environment = {
  PRIORSEAL_ENVIRONMENT: 'production', PRIORSEAL_RUNTIME: 'cloudflare-workers', PRIORSEAL_DATABASE_BACKEND: 'd1',
  PRIORSEAL_ISSUER: 'priorseal.xyz', PRIORSEAL_KEY_ID: 'production-1', PRIORSEAL_BUILD_VERSION: 'a'.repeat(40), PRIORSEAL_AUTHORIZATION_AUDIENCE: 'priorseal.xyz', PRIORSEAL_PREEXECUTION_PROOF_MODE: 'rfc3161',
  PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS: 'false', PRIORSEAL_TRUST_PROXY: 'true',
  PRIORSEAL_ZEROEX_ENABLED: 'false',
  PRIORSEAL_PRIVATE_KEY_PEM: '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----', PRIORSEAL_PUBLIC_KEY_PEM: '-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----', PRIORSEAL_POLICY_JSON: '{}', PRIORSEAL_CORS_ORIGINS: 'https://priorseal.example',
  PRIORSEAL_X402_FACILITATOR_URL: 'https://api.cdp.coinbase.com/platform/v2/x402', PRIORSEAL_X402_FACILITATOR_AUTH_MODE: 'cdp', PRIORSEAL_X402_RESOURCE_ORIGIN: origin, PRIORSEAL_X402_PAY_TO: payTo, PRIORSEAL_X402_NETWORKS: 'eip155:8453', PRIORSEAL_X402_TIMEOUT_MS: '15000', PRIORSEAL_X402_CDP_API_KEY_ID: 'cdp-key-fixture', PRIORSEAL_X402_CDP_API_KEY_SECRET: 'QGHLFeD2HU1ncQQlJuQhaQcI+FIWGbZeW/2mIZZydJ43ZqgzFpu4sfPhJQn56pMn3vC0uDrNsQXuOtcnz0WAwg==', PRIORSEAL_X402_ROUTES_JSON: JSON.stringify([{ method: 'GET', path, description: 'Export a portable receipt bundle', price: '$0.01' }]),
};

test('production x402 readiness is quote-only and rejects any settlement path', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; paymentSignature: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, method: request.method, paymentSignature: request.headers.get('payment-signature') });
    if (request.url === 'https://api.cdp.coinbase.com/platform/v2/x402/supported') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }] });
    if (request.url === `${origin}/v1/capabilities`) return Response.json({ payments: { x402: { configured: true, networks: [{ network: 'eip155:8453' }], routes: [{ method: 'GET', path, description: 'Export a portable receipt bundle', price: '$0.01' }] } } });
    if (request.url === probeUrl) return Response.json(challenge, { status: 402, headers: { 'payment-required': Buffer.from(JSON.stringify(challenge)).toString('base64') } });
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const logged: string[] = [];
  await runX402ProductionReadiness(environment as NodeJS.ProcessEnv, message => { logged.push(message); });
  assert.deepEqual(requests.map(request => request.method), ['GET', 'GET', 'GET']);
  assert.ok(requests.every(request => request.paymentSignature === null));
  assert.equal(logged.length, 1);
});
