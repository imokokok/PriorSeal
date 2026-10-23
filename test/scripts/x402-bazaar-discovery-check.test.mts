import test from 'node:test';
import assert from 'node:assert/strict';
import { runX402BazaarDiscoveryCheck } from '../../scripts/x402-bazaar-discovery-check.mjs';

const origin = 'https://priorseal.example';
const routeTemplates = [
  '/v1/receipts/:receiptId/bundle',
  '/v1/evidence/receipts/:receiptId',
  '/v1/evidence/receipts/:receiptId/check',
];
const environment = {
  PRIORSEAL_X402_RESOURCE_ORIGIN: origin,
  PRIORSEAL_X402_CDP_API_KEY_ID: 'organizations/example/apiKeys/key-1',
  // A fixture-only 64-byte Ed25519 private/public key pair. It is not a CDP credential.
  PRIORSEAL_X402_CDP_API_KEY_SECRET: 'QGHLFeD2HU1ncQQlJuQhaQcI+FIWGbZeW/2mIZZydJ43ZqgzFpu4sfPhJQn56pMn3vC0uDrNsQXuOtcnz0WAwg==',
};

test('Bazaar discovery checker confirms every paid PriorSeal route in the CDP catalog without a payment attempt', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; method: string; paymentSignature: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.push({ url, method: request.method, paymentSignature: request.headers.get('payment-signature') });
    if (url.toString() === `${origin}/v1/capabilities`) {
      return Response.json(capabilities());
    }
    if (url.origin === 'https://api.cdp.coinbase.com' && url.pathname === '/platform/v2/x402/discovery/search') {
      assert.equal(url.searchParams.get('urlSubstring'), 'priorseal.example');
      assert.equal(url.searchParams.get('extensions'), 'bazaar');
      assert.equal(url.searchParams.get('limit'), '100');
      const authorization = request.headers.get('authorization');
      assert.ok(authorization?.startsWith('Bearer '));
      const jwt = authorization!.slice('Bearer '.length).split('.');
      const payload = JSON.parse(Buffer.from(jwt[1], 'base64url').toString('utf8')) as Record<string, unknown>;
      assert.deepEqual(payload.uris, ['GET api.cdp.coinbase.com/platform/v2/x402/discovery/search']);
      return Response.json({ resources: routeTemplates.map(catalogEntry) });
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const logged: string[] = [];

  await runX402BazaarDiscoveryCheck(environment, message => { logged.push(message); });

  assert.deepEqual(requests.map(request => request.method), ['GET', 'GET']);
  assert.ok(requests.every(request => request.paymentSignature === null));
  assert.equal(logged.length, 1);
  assert.deepEqual(JSON.parse(logged[0]) as { listed: boolean; routes: string[]; paymentAttempted: boolean; settlementAttempted: boolean }, {
    listed: true,
    resourceOrigin: origin,
    routes: routeTemplates,
    checks: ['production-capabilities', 'cdp-bazaar-catalog', 'bazaar-service-metadata', 'bazaar-input-output-schema'],
    paymentAttempted: false,
    settlementAttempted: false,
  });
});

test('Bazaar discovery checker rejects an absent route instead of reporting a partial catalog as listed', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof URL ? input : typeof input === 'string' ? input : input.url);
    if (url.toString() === `${origin}/v1/capabilities`) return Response.json(capabilities());
    if (url.pathname === '/platform/v2/x402/discovery/search') return Response.json({ resources: [catalogEntry(routeTemplates[0])] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(runX402BazaarDiscoveryCheck(environment, () => {}), /v1\/evidence\/receipts\/:receiptId/);
});

function capabilities() {
  return {
    payments: { x402: { configured: true, routes: [{ method: 'GET', path: routeTemplates[0] }] } },
    evidenceApi: {
      commerce: {
        x402: {
          enabled: true,
          staticExportPaths: ['/v1/receipts/{receiptId}/bundle', '/v1/evidence/receipts/{receiptId}'],
          paymentPath: '/v1/evidence/receipts/{receiptId}/check',
        },
      },
    },
  };
}

function catalogEntry(routeTemplate: string) {
  const concretePath = routeTemplate.replace(':receiptId', 'psr_bazaar_example');
  return {
    resource: {
      url: `${origin}${concretePath}`,
      description: 'A paid PriorSeal evidence resource',
      mimeType: 'application/json',
      serviceName: 'PriorSeal Evidence API',
      tags: ['agent-evidence', 'authorization', 'execution', 'verification', 'x402'],
      iconUrl: `${origin}/priorseal-mark.svg`,
    },
    extensions: {
      bazaar: {
        info: {
          input: { type: 'http', method: 'GET', pathParams: { receiptId: 'psr_bazaar_example' } },
          output: { type: 'json', format: outputFormat(routeTemplate), example: { schema: outputFormat(routeTemplate) } },
        },
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            input: { type: 'object', required: ['type', 'method', 'pathParams'] },
            output: { type: 'object', required: ['type'] },
          },
          required: ['input'],
        },
        routeTemplate,
      },
    },
  };
}

function outputFormat(path: string) {
  if (path.endsWith('/bundle')) return 'priorseal.verification-bundle.v1';
  if (path.endsWith('/check')) return 'priorseal.fresh-evidence-check.v1';
  return 'priorseal.evidence.v1';
}
