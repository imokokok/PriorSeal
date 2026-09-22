// Generated from observation-worker.mts by npm run core:build. Do not edit directly.
import { errorCode } from "../../shared/error-code.mjs";
import { randomUUID } from "node:crypto";
import { detectReorg } from "../../domain/execution.mjs";
const retryable = /* @__PURE__ */ new Set(["PENDING", "NOT_FOUND", "RPC_ERROR", "RPC_TIMEOUT"]);
function createObservationWorker({ observe, saveObservation, store = null, clock = () => Date.now(), retryDelayMs = 5e3, maxAttempts = 8, jobLeaseMs = 15 * 6e4, jitter = () => 0.5 }) {
  if (typeof observe !== "function" || typeof saveObservation !== "function") throw new TypeError("observe and saveObservation are required");
  const jobs = /* @__PURE__ */ new Map();
  async function enqueuePersistent(input) {
    if (!store?.enqueueJob) return enqueue(input);
    const { idempotencyKey, ...workInput } = input;
    const now = clock();
    const job = { jobId: randomUUID(), idempotencyKey: idempotencyKey || `${input.chainId}:${input.txHash}:${input.confirmations ?? 0}`, input: workInput, state: "QUEUED", attempts: 0, createdAt: now, nextAttemptAt: now, observation: null, result: null, error: null };
    return store.enqueueJob(job);
  }
  function enqueue(input) {
    const { idempotencyKey, ...workInput } = input;
    const key = idempotencyKey || `${input.chainId}:${input.txHash}:${input.confirmations ?? 0}`;
    const existing = [...jobs.values()].find((job2) => job2.key === key);
    if (existing) return existing;
    const job = { jobId: randomUUID(), key, input: workInput, state: "QUEUED", attempts: 0, createdAt: clock(), nextAttemptAt: clock(), observation: null, result: null, error: null };
    jobs.set(job.jobId, job);
    return job;
  }
  async function runOnce() {
    const persistentClaims = Boolean(store?.claimDueJobs);
    const due = store?.claimDueJobs ? await store.claimDueJobs(clock(), 10, jobLeaseMs) : [...jobs.values()].filter((job) => ["QUEUED", "RETRY_WAIT"].includes(job.state) && job.nextAttemptAt <= clock());
    for (const job of due) {
      job.state = "RUNNING";
      if (!persistentClaims) job.attempts += 1;
      try {
        const previous = job.observation ?? (store?.getObservation ? await store.getObservation(job.input.chainId, job.input.txHash) : null);
        const observed = await observe(job.input);
        const result = isObservationResult(observed) ? observed : null;
        const observation = result?.observation ?? observed;
        if (!isWorkerObservation(observation)) throw new TypeError("Observer returned an invalid observation");
        if (detectReorg(previous, observation)) {
          observation.status = "REORGED";
          observation.finalityState = "REORGED";
          observation.previousBlockHash = previous?.blockHash;
        }
        job.observation = observation;
        job.result = result ? { ...result, observation } : null;
        await saveObservation(observation);
        job.error = null;
        if (retryable.has(observation.status) && job.attempts < maxAttempts) {
          job.state = "RETRY_WAIT";
          job.nextAttemptAt = nextRetry(job.attempts);
        } else {
          job.state = observation.status === "CONFIRMED" || observation.status === "REVERTED" ? "COMPLETED" : "UNDETERMINED";
        }
      } catch (error) {
        job.error = { code: errorCode(error) || "OBSERVATION_ERROR", message: "Observation attempt failed" };
        job.state = job.attempts < maxAttempts ? "RETRY_WAIT" : "FAILED";
        job.nextAttemptAt = nextRetry(job.attempts);
      }
      if (store?.saveJob) await store.saveJob(job);
    }
    return due;
  }
  function nextRetry(attempts) {
    const capped = retryDelayMs * Math.min(2 ** Math.max(0, attempts - 1), 32);
    return clock() + Math.floor(capped * (0.75 + jitter() * 0.5));
  }
  return { enqueue, enqueuePersistent, get(jobId) {
    return store?.getJob ? store.getJob(jobId) : jobs.get(jobId);
  }, list() {
    return store?.listJobs ? store.listJobs() : [...jobs.values()];
  }, runOnce, start(intervalMs = retryDelayMs) {
    const timer = setInterval(() => {
      runOnce().catch(() => {
      });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  } };
}
function isWorkerObservation(value) {
  return value !== null && typeof value === "object" && typeof value.status === "string" && typeof value.txHash === "string";
}
function isObservationResult(value) {
  return value !== null && typeof value === "object" && "observation" in value && isWorkerObservation(value.observation);
}
export {
  createObservationWorker
};
