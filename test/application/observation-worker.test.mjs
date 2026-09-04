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
test('re-observation detects a changed block hash', () => { assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', blockHash: '0xb' }), true); assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', blockHash: '0xa' }), false); });
