import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservationWorker } from '../../src/index.mjs';
import { detectReorg } from '../../src/domain/execution.mjs';
test('observation worker is idempotent and retries pending observations', async () => {
  let now = 1000; let calls = 0; const saved = [];
  const worker = createObservationWorker({ clock: () => now, retryDelayMs: 10, observe: async () => ({ status: ++calls === 1 ? 'PENDING' : 'CONFIRMED', txHash: '0x1' }), saveObservation: async (value) => saved.push(value) });
  const first = worker.enqueue({ chainId: 8453, txHash: '0x1', confirmations: 2, idempotencyKey: 'same' }); assert.equal(worker.enqueue({ chainId: 8453, txHash: '0x1', idempotencyKey: 'same' }).jobId, first.jobId);
  await worker.runOnce(); assert.equal(worker.get(first.jobId).state, 'RETRY_WAIT'); now += 10; await worker.runOnce(); assert.equal(worker.get(first.jobId).state, 'COMPLETED'); assert.equal(saved.length, 2);
});
test('re-observation detects changed blocks and transactions removed by a reorg', () => { assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', blockHash: '0xb' }), true); assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', status: 'NOT_FOUND', blockHash: null }), true); assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', blockHash: '0xa' }), false); });
test('persistent worker does not double-count atomically claimed attempts', async () => {
  let saved;
  const store = {
    async claimDueJobs() { return [{ jobId: 'job-1', input: { chainId: 8453, txHash: '0x1' }, state: 'RUNNING', attempts: 1, nextAttemptAt: 0, observation: null }]; },
    async saveJob(job) { saved = { ...job }; return saved; },
  };
  const worker = createObservationWorker({ store, retryDelayMs: 10, observe: async () => ({ status: 'PENDING', txHash: '0x1' }), saveObservation: async () => {} });
  await worker.runOnce();
  assert.equal(saved.attempts, 1);
  assert.equal(saved.state, 'RETRY_WAIT');
});
