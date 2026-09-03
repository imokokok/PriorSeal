import { randomUUID } from 'node:crypto';
import { detectReorg } from '../core/execution.mjs';

const retryable = new Set(['PENDING', 'NOT_FOUND', 'RPC_ERROR', 'RPC_TIMEOUT']);
export function createObservationWorker({ observe, saveObservation, clock = () => Date.now(), retryDelayMs = 5000, maxAttempts = 8 } = {}) {
  if (typeof observe !== 'function' || typeof saveObservation !== 'function') throw new TypeError('observe and saveObservation are required');
  const jobs = new Map();
  function enqueue(input) {
    const key = input.idempotencyKey || `${input.chainId}:${input.txHash}:${input.confirmations ?? 0}`;
    const existing = [...jobs.values()].find((job) => job.key === key);
    if (existing) return existing;
    const job = { jobId: randomUUID(), key, input: { ...input }, state: 'QUEUED', attempts: 0, createdAt: clock(), nextAttemptAt: clock(), observation: null, error: null };
    jobs.set(job.jobId, job); return job;
  }
  async function runOnce() {
    const due = [...jobs.values()].filter((job) => ['QUEUED', 'RETRY_WAIT'].includes(job.state) && job.nextAttemptAt <= clock());
    for (const job of due) {
      job.state = 'RUNNING'; job.attempts += 1;
      try {
        const observation = await observe(job.input); if (detectReorg(job.observation, observation)) observation.status = 'REORGED', observation.finalityState = 'REORGED'; job.observation = observation; await saveObservation(observation);
        if (observation.status === 'PENDING' && job.attempts < maxAttempts) { job.state = 'RETRY_WAIT'; job.nextAttemptAt = clock() + retryDelayMs; }
        else { job.state = observation.status === 'CONFIRMED' || observation.status === 'REVERTED' ? 'COMPLETED' : 'UNDETERMINED'; }
      } catch (error) {
        job.error = { code: error.code || 'OBSERVATION_ERROR', message: error.message }; job.state = job.attempts < maxAttempts ? 'RETRY_WAIT' : 'FAILED'; job.nextAttemptAt = clock() + retryDelayMs * Math.min(2 ** (job.attempts - 1), 32);
      }
    }
    return due;
  }
  return { enqueue, get(jobId) { return jobs.get(jobId); }, list() { return [...jobs.values()]; }, runOnce, start(intervalMs = retryDelayMs) { const timer = setInterval(() => { runOnce().catch(() => {}); }, intervalMs); timer.unref?.(); return () => clearInterval(timer); } };
}
