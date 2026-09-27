import { retryDelaySeconds, shouldRedeliverJob } from './cloudflare-retry.mjs';
import { errorMessage } from '../shared/error-code.mjs';
import type { createObservationWorker } from '../application/observations/observation-worker.mjs';

type Worker = Pick<ReturnType<typeof createObservationWorker>, 'runJob' | 'get'>;

/** Each message is only a prompt; D1 leases remain the authority for execution. */
export async function processObservationQueue(batch: MessageBatch<{ jobId: string }>, worker: Worker, queue: Queue<{ jobId: string }>) {
  for (const message of batch.messages) {
    try {
      const jobId = message.body?.jobId;
      if (typeof jobId !== 'string' || !jobId) {
        console.warn(JSON.stringify({ level: 'warn', event: 'observation.queue_invalid_message' }));
        message.ack();
        continue;
      }
      await worker.runJob(jobId);
      const job = await worker.get(jobId);
      if (shouldRedeliverJob(job)) await queue.send({ jobId }, { delaySeconds: retryDelaySeconds([job]) ?? undefined });
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'observation.queue_message_failed', message: errorMessage(error) }));
      message.retry({ delaySeconds: 30 });
    }
  }
}
