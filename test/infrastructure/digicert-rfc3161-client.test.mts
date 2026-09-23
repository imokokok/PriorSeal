import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigiCertTimestampProvider } from '../../src/infrastructure/timestamp/digicert-rfc3161-client.mjs';
import type { TimestampPolicy } from '../../src/domain/rfc3161.mjs';

const policy: TimestampPolicy = { schema: 'priorseal.timestamp-policy.v1', profile: 'digicert-rfc3161-v1', maxClockSkewSeconds: 300 };

function hasCode(error: unknown, code: string): error is { code: string; message: string } {
  return error instanceof Error && 'code' in error && error.code === code;
}

test('DigiCert provider uses Worker-compatible manual redirects and rejects redirect responses', async () => {
  let requestOptions: RequestInit | undefined;
  const provider = createDigiCertTimestampProvider({
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Response(null, { status: 302, headers: { location: 'https://example.invalid/' } });
    },
  });

  await assert.rejects(
    provider({ authorization: {}, acceptance: { acceptedAt: Math.floor(Date.now() / 1000) }, policy }),
    (error) => hasCode(error, 'TIMESTAMP_SERVICE_UNAVAILABLE') && /redirect/.test(error.message),
  );
  assert.ok(requestOptions);
  assert.equal(requestOptions.redirect, 'manual');
});
