// Generated from digicert-rfc3161-client.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { createDigiCertTimestampProvider } from "../../src/infrastructure/timestamp/digicert-rfc3161-client.mjs";
const policy = { schema: "priorseal.timestamp-policy.v1", profile: "digicert-rfc3161-v1", maxClockSkewSeconds: 300 };
function hasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}
test("DigiCert provider uses Worker-compatible manual redirects and rejects redirect responses", async () => {
  let requestOptions;
  const provider = createDigiCertTimestampProvider({
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return new Response(null, { status: 302, headers: { location: "https://example.invalid/" } });
    }
  });
  await assert.rejects(
    provider({ authorization: {}, acceptance: { acceptedAt: Math.floor(Date.now() / 1e3) }, policy }),
    (error) => hasCode(error, "TIMESTAMP_SERVICE_UNAVAILABLE") && /redirect/.test(error.message)
  );
  assert.ok(requestOptions);
  assert.equal(requestOptions.redirect, "manual");
});
