import test from 'node:test';
import assert from 'node:assert/strict';
import { retryDelaySeconds, shouldRedeliverJob } from '../../src/bootstrap/cloudflare-retry.mjs';

test('Cloudflare queue keeps prompts alive until their database job is terminal', () => {
  assert.equal(shouldRedeliverJob({ state: 'QUEUED' }), true);
  assert.equal(shouldRedeliverJob({ state: 'RUNNING' }), true);
  assert.equal(shouldRedeliverJob({ state: 'RETRY_WAIT' }), true);
  assert.equal(shouldRedeliverJob({ state: 'UNDETERMINED' }), false);
  assert.equal(shouldRedeliverJob({ state: 'COMPLETED' }), false);
  assert.equal(shouldRedeliverJob(null), false);
});

test('Cloudflare queue schedules early prompts without acknowledging away future work', () => {
  const now = 1_700_000_000_000;
  assert.equal(retryDelaySeconds([{ state: 'RETRY_WAIT', nextAttemptAt: now + 5_001 }], { now }), 6);
  assert.equal(retryDelaySeconds([{ state: 'RETRY_WAIT', nextAttemptAt: now - 1 }], { now }), 1);
  assert.equal(retryDelaySeconds([{ state: 'RUNNING', nextAttemptAt: now - 1 }], { now }), 30);
  assert.equal(retryDelaySeconds([], { now }), null);
});
