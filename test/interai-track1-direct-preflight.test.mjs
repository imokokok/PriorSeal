// Generated from interai-track1-direct-preflight.test.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  curlConfig,
  runCurl
} from "../scripts/run-interai-track1-direct-preflight.mjs";
test("direct /verify transport sends one authenticated request and retains response headers", async () => {
  process.env.NODE_ENV = "test";
  const dir = await mkdtemp(path.join(tmpdir(), "interai-transport-"));
  const requestPath = path.join(dir, "request.json");
  const headersPath = path.join(dir, "headers.txt");
  const body = '{"use_case":"transport-test","action":{"type":"read_only_lookup"}}';
  await writeFile(requestPath, body);
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests += 1;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/verify");
    assert.equal(req.headers.authorization, "Bearer test-only-token");
    assert.equal(req.headers["x-idempotency-key"], "candidate-test-001");
    let received = "";
    for await (const chunk of req) received += String(chunk);
    assert.equal(received, body);
    res.setHeader("Content-Type", "application/json");
    res.end('{"recommended_action":"block"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const config = curlConfig(
      "test-only-token",
      requestPath,
      "candidate-test-001",
      headersPath,
      void 0,
      `http://127.0.0.1:${address.port}/verify`
    );
    const response = await runCurl(config);
    assert.equal(response.exitCode, 0);
    assert.equal(
      response.body.toString("utf8"),
      '{"recommended_action":"block"}'
    );
    assert.match(await readFile(headersPath, "utf8"), /^HTTP\/1\.1 200 /);
    assert.equal(requests, 1);
    assert.doesNotMatch(response.stderr, /test-only-token/);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("transport rejects an unpinned endpoint outside the local test mode", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(
      () => curlConfig(
        "test-only-token",
        "/tmp/request.json",
        "candidate-test-001",
        "/tmp/headers.txt",
        void 0,
        "https://example.com/verify"
      ),
      /Unpinned InterAI endpoint/
    );
  } finally {
    if (previous === void 0) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
