import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigiCertTimestampProvider } from '../../src/infrastructure/timestamp/digicert-rfc3161-client.mjs';

test('DigiCert provider uses Worker-compatible manual redirects and rejects redirect responses', async () => {
  let requestOptions;
  const provider = createDigiCertTimestampProvider({
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Response(null, { status: 302, headers: { location: 'https://example.invalid/' } });
    },
  });

  await assert.rejects(
    provider({ authorization: {}, acceptance: { acceptedAt: Math.floor(Date.now() / 1000) }, policy: {} }),
    (error) => error?.code === 'TIMESTAMP_SERVICE_UNAVAILABLE' && /redirect/.test(error.message),
  );
  assert.equal(requestOptions.redirect, 'manual');
});
