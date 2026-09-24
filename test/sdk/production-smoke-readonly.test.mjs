// Generated from production-smoke-readonly.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { runReadOnlySmoke } from "../../scripts/production-smoke-readonly.mjs";
test("read-only smoke rejects a malformed health envelope before trusting deployment data", async () => {
  const requests = [];
  await assert.rejects(runReadOnlySmoke({
    env: { ...process.env, PRIORSEAL_EXPECTED_VERSION: "a".repeat(40) },
    log: () => {
    },
    fetcher: async (input, init) => {
      assert.equal(init?.method, "GET");
      requests.push(String(input));
      return Response.json([]);
    }
  }), /Liveness response must be a JSON object/);
  assert.equal(requests.length, 1);
});
