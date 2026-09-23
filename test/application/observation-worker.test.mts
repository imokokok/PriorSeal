import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservationWorker } from '../../src/index.mjs';
import { detectReorg } from '../../src/domain/execution.mjs';
import type { ObservationJob } from '../../src/application/observations/observation-worker.mjs';
test('observation worker is idempotent and retries pending observations', async () => {
  let now = 1000; let calls = 0; const saved: unknown[] = [];
  const worker = createObservationWorker({ clock: () => now, retryDelayMs: 10, observe: async () => ({ status: ++calls === 1 ? 'PENDING' : 'CONFIRMED', txHash: '0x1' }), saveObservation: async (value) => saved.push(value) });
  const first = worker.enqueue({ chainId: 8453, txHash: '0x1', confirmations: 2, idempotencyKey: 'same' }); assert.equal(worker.enqueue({ chainId: 8453, txHash: '0x1', idempotencyKey: 'same' }).jobId, first.jobId);
  await worker.runOnce(); assert.equal((await worker.get(first.jobId))?.state, 'RETRY_WAIT'); now += 10; await worker.runOnce(); assert.equal((await worker.get(first.jobId))?.state, 'COMPLETED'); assert.equal(saved.length, 2);
});
test('re-observation detects changed blocks and transactions removed by a reorg', () => { assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', blockHash: '0xb' }), true); assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', status: 'NOT_FOUND', blockHash: null }), true); assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', blockHash: '0xa' }), false); });
test('persistent worker does not double-count atomically claimed attempts', async () => {
  let saved: ObservationJob | undefined;
  const claimed: ObservationJob = {
    jobId: 'job-1', input: { chainId: 8453, txHash: '0x1' }, state: 'RUNNING', attempts: 1,
    createdAt: 0, nextAttemptAt: 0, observation: null, result: null, error: null,
  };
  const store = {
    async claimDueJobs() { return [claimed]; },
    async saveJob(job: ObservationJob) { saved = { ...job }; return saved; },
  };
  const worker = createObservationWorker({ store, retryDelayMs: 10, observe: async () => ({ status: 'PENDING', txHash: '0x1' }), saveObservation: async () => {} });
  await worker.runOnce();
  assert.ok(saved);
  assert.equal(saved.attempts, 1);
  assert.equal(saved.state, 'RETRY_WAIT');
});
test('observation worker preserves the final receipt result for resumable clients', async () => {
  const receipt = { receiptId: 'psr-final' };
  const worker = createObservationWorker({
    observe: async () => ({ observation: { status: 'CONFIRMED', txHash: '0x1' }, receipt, verification: { valid: true, code: 'OK' } }),
    saveObservation: async () => {},
  });
  const job = worker.enqueue({ chainId: 8453, txHash: '0x1' });
  await worker.runOnce();
  const completed = await worker.get(job.jobId);
  assert.ok(completed?.result);
  assert.equal(completed.state, 'COMPLETED');
  assert.deepEqual(completed.result.receipt, receipt);
  assert.deepEqual(completed.result.verification, { valid: true, code: 'OK' });
});

test('observation worker clears a transient error after a successful retry', async () => {
  let now = 1_000; let calls = 0;
  const worker = createObservationWorker({
    clock: () => now,
    retryDelayMs: 10,
    jitter: () => 0.5,
    observe: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('temporary failure'), { code: 'RPC_TIMEOUT' });
      return { chainId: 8453, txHash: '0x1', status: 'CONFIRMED', finalityState: 'CONFIRMED' };
    },
    saveObservation: async () => {},
  });
  const job = worker.enqueue({ chainId: 8453, txHash: '0x1' });
  await worker.runOnce();
  now += 10;
  await worker.runOnce();
  const completed = await worker.get(job.jobId);
  assert.ok(completed);
  assert.equal(completed.state, 'COMPLETED');
  assert.equal(completed.error, null);
});
