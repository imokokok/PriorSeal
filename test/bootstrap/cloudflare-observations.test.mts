import test from 'node:test';
import assert from 'node:assert/strict';
import { processObservationQueue } from '../../src/bootstrap/cloudflare-observations.mjs';
import { createObservationWorker } from '../../src/application/observations/observation-worker.mjs';
import { createD1Store } from '../../src/infrastructure/persistence/d1-store.mjs';
import { testD1 } from '../support/d1.mjs';

function messages(bodies: unknown[]) {
  const outcomes = bodies.map(() => ({ acknowledgments: 0, retries: 0 }));
  const batch = { messages: bodies.map((body, index) => ({
    body,
    ack() { outcomes[index].acknowledgments++; },
    retry(options: { delaySeconds: number }) { assert.equal(options.delaySeconds, 30); outcomes[index].retries++; },
  })) } as unknown as MessageBatch<{ jobId: string }>;
  return { batch, outcomes };
}

test('queue prompts only run their task; retries, duplicate delivery and cron recovery preserve evidence', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const fixture = testD1();
  try {
    const store = createD1Store(fixture.database);
    let now = 1000;
    const observed: string[] = [];
    const worker = createObservationWorker({
      store, clock: () => now,
      observe: async (input) => { observed.push(input.txHash); return { chainId: 8453, txHash: input.txHash, status: input.txHash === 'pending' ? 'PENDING' : 'CONFIRMED' }; },
      saveObservation: async (observation) => store.saveObservation({ ...observation, chainId: 8453 }),
    });
    const ready = await worker.enqueuePersistent({ chainId: 8453, txHash: 'ready' });
    const pending = await worker.enqueuePersistent({ chainId: 8453, txHash: 'pending' });
    const missed = await worker.enqueuePersistent({ chainId: 8453, txHash: 'missed-prompt' });
    const sent: { jobId: string; delaySeconds: number | undefined }[] = [];
    let failDispatch = true;
    const queue = { async send(body: { jobId: string }, options: { delaySeconds?: number }) {
      if (failDispatch) throw new Error('temporary queue dispatch failure');
      sent.push({ jobId: body.jobId, delaySeconds: options.delaySeconds });
    } } as unknown as Queue<{ jobId: string }>;
    const first = messages([{ jobId: ready.jobId }, { jobId: pending.jobId }, null, { jobId: 'missing' }]);
    await processObservationQueue(first.batch, worker, queue);
    assert.deepEqual(observed, ['ready', 'pending']);
    assert.deepEqual(first.outcomes, [
      { acknowledgments: 1, retries: 0 }, { acknowledgments: 0, retries: 1 },
      { acknowledgments: 1, retries: 0 }, { acknowledgments: 1, retries: 0 },
    ]);
    assert.equal((await store.getJob(missed.jobId))?.state, 'QUEUED');
    failDispatch = false;
    const early = messages([{ jobId: ready.jobId }, { jobId: pending.jobId }]);
    await processObservationQueue(early.batch, worker, queue);
    assert.deepEqual(observed, ['ready', 'pending'], 'early and terminal prompts do not invoke RPC observation');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jobId, pending.jobId);
    assert.equal(sent[0].delaySeconds, 5);
    assert.equal((await store.getJob(pending.jobId))?.attempts, 1);
    now += 5000;
    await worker.runOnce();
    assert.ok(observed.includes('missed-prompt'), 'scheduled sweeps still recover a missing prompt');
    assert.equal((await store.getJob(pending.jobId))?.attempts, 2);
    assert.equal((await store.getJob(missed.jobId))?.state, 'COMPLETED');
  } finally { fixture.sqlite.close(); }
});
