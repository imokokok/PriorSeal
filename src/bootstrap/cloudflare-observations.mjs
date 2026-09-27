// Generated from cloudflare-observations.mts by npm run core:build. Do not edit directly.
import { retryDelaySeconds, shouldRedeliverJob } from "./cloudflare-retry.mjs";
import { errorMessage } from "../shared/error-code.mjs";
async function processObservationQueue(batch, worker, queue) {
  for (const message of batch.messages) {
    try {
      const jobId = message.body?.jobId;
      if (typeof jobId !== "string" || !jobId) {
        console.warn(JSON.stringify({ level: "warn", event: "observation.queue_invalid_message" }));
        message.ack();
        continue;
      }
      await worker.runJob(jobId);
      const job = await worker.get(jobId);
      if (shouldRedeliverJob(job)) await queue.send({ jobId }, { delaySeconds: retryDelaySeconds([job]) ?? void 0 });
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "observation.queue_message_failed", message: errorMessage(error) }));
      message.retry({ delaySeconds: 30 });
    }
  }
}
export {
  processObservationQueue
};
