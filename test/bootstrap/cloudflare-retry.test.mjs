// Generated from cloudflare-retry.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { retryDelaySeconds, shouldRedeliverJob } from "../../src/bootstrap/cloudflare-retry.mjs";
const job = (state, nextAttemptAt = 0) => ({ jobId: `job-${state}`, state, nextAttemptAt });
test("Cloudflare queue keeps prompts alive until their database job is terminal", () => {
  assert.equal(shouldRedeliverJob(job("QUEUED")), true);
  assert.equal(shouldRedeliverJob(job("RUNNING")), true);
  assert.equal(shouldRedeliverJob(job("RETRY_WAIT")), true);
  assert.equal(shouldRedeliverJob(job("UNDETERMINED")), false);
  assert.equal(shouldRedeliverJob(job("COMPLETED")), false);
  assert.equal(shouldRedeliverJob(null), false);
});
test("Cloudflare queue schedules early prompts without acknowledging away future work", () => {
  const now = 17e11;
  assert.equal(retryDelaySeconds([job("RETRY_WAIT", now + 5001)], { now }), 6);
  assert.equal(retryDelaySeconds([job("RETRY_WAIT", now - 1)], { now }), 1);
  assert.equal(retryDelaySeconds([job("RUNNING", now - 1)], { now }), 30);
  assert.equal(retryDelaySeconds([], { now }), null);
});
