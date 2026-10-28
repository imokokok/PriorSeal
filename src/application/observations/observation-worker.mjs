// Generated from observation-worker.mts by npm run core:build. Do not edit directly.
import { errorCode } from "../../shared/error-code.mjs";
import { randomUUID } from "node:crypto";
import { detectReorg } from "../../domain/execution.mjs";
const retryable = /* @__PURE__ */ new Set(["PENDING", "NOT_FOUND", "RPC_ERROR", "RPC_TIMEOUT"]);
const SOLANA_RETRY_DELAYS_MS = [5e3, 15e3, 45e3, 9e4, 18e4];
const EVM_RETRY_DELAYS_MS = [8e3, 24e3, 72e3, 18e4];
const terminal = /* @__PURE__ */ new Set(["COMPLETED", "UNDETERMINED", "FAILED"]);
function chainObservationRetryPolicy(input) {
  const delays = Number(input.chainId) === 0 ? SOLANA_RETRY_DELAYS_MS : EVM_RETRY_DELAYS_MS;
  return { maxAttempts: delays.length + 1, retryDelayMs: (attempt) => delays[Math.min(Math.max(0, attempt - 1), delays.length - 1)] };
}
function createObservationWorker({ observe, saveObservation, observerManagesEvidence = false, store = null, clock = () => Date.now(), retryDelayMs = 5e3, maxAttempts = 8, retryPolicy, jobLeaseMs = 15 * 6e4, jitter = () => 0.5 }) {
  if (typeof observe !== "function" || typeof saveObservation !== "function") throw new TypeError("observe and saveObservation are required");
  const jobs = /* @__PURE__ */ new Map();
  const jobsByKey = /* @__PURE__ */ new Map();
  const activeJobsByCoalesceKey = /* @__PURE__ */ new Map();
  async function enqueuePersistent(input) {
    if (!store?.enqueueJob) return enqueue(input);
    const { idempotencyKey, coalesceKey, ...workInput } = input;
    const naturalKey = `${input.chainId}:${input.txHash}:${input.confirmations ?? 0}`;
    const now = clock();
    const job = { jobId: randomUUID(), idempotencyKey: idempotencyKey || naturalKey, coalesceKey: coalesceKey || naturalKey, input: workInput, state: "QUEUED", attempts: 0, createdAt: now, nextAttemptAt: now, observation: null, result: null, error: null };
    return store.enqueueJob(job);
  }
  function enqueue(input) {
    const { idempotencyKey, coalesceKey, ...workInput } = input;
    const naturalKey = `${input.chainId}:${input.txHash}:${input.confirmations ?? 0}`;
    const key = idempotencyKey || naturalKey;
    const activeKey = coalesceKey || naturalKey;
    const existing = jobsByKey.get(key);
    if (existing) return existing;
    const active = activeJobsByCoalesceKey.get(activeKey);
    if (active && !terminal.has(active.state)) return active;
    const job = { jobId: randomUUID(), key, idempotencyKey: key, coalesceKey: activeKey, input: workInput, state: "QUEUED", attempts: 0, createdAt: clock(), nextAttemptAt: clock(), observation: null, result: null, error: null };
    jobs.set(job.jobId, job);
    jobsByKey.set(key, job);
    activeJobsByCoalesceKey.set(activeKey, job);
    return job;
  }
  async function runOnce() {
    const persistentClaims = Boolean(store?.claimDueJobs);
    const due = store?.claimDueJobs ? await store.claimDueJobs(clock(), 10, jobLeaseMs) : [...jobs.values()].filter((job) => ["QUEUED", "RETRY_WAIT"].includes(job.state) && job.nextAttemptAt <= clock());
    return processJobs(due, persistentClaims);
  }
  async function runJob(jobId) {
    if (store?.claimDueJobs && !store.claimJob) throw new TypeError("Targeted observation requires atomic claimJob support");
    const job = store?.claimJob ? await store.claimJob(jobId, clock(), jobLeaseMs) : jobs.get(jobId);
    if (!job && store?.claimJob) return store.getJob?.(jobId);
    const due = job && (store?.claimJob || ["QUEUED", "RETRY_WAIT"].includes(job.state) && job.nextAttemptAt <= clock()) ? [job] : [];
    return (await processJobs(due, Boolean(store?.claimJob)))[0] ?? job;
  }
  async function processJobs(due, persistentClaims) {
    for (const job of due) {
      job.state = "RUNNING";
      if (!persistentClaims) job.attempts += 1;
      try {
        const previous = observerManagesEvidence ? null : job.observation ?? (store?.getObservation ? await store.getObservation(job.input.chainId, job.input.txHash) : null);
        const observed = await observe(job.input);
        const result = isObservationResult(observed) ? observed : null;
        const observation = result?.observation ?? observed;
        if (!isWorkerObservation(observation)) throw new TypeError("Observer returned an invalid observation");
        if (!observerManagesEvidence && detectReorg(previous, observation)) {
          observation.status = "REORGED";
          observation.finalityState = "REORGED";
          observation.previousBlockHash = previous?.blockHash;
        }
        job.observation = observation;
        job.result = result ? { ...result, observation } : null;
        if (!observerManagesEvidence) await saveObservation(observation);
        job.error = null;
        if (retryable.has(observation.status) && job.attempts < attemptLimit(job)) {
          job.state = "RETRY_WAIT";
          job.nextAttemptAt = nextRetry(job);
        } else {
          job.state = observation.status === "CONFIRMED" || observation.status === "REVERTED" ? "COMPLETED" : "UNDETERMINED";
        }
      } catch (error) {
        job.error = { code: errorCode(error) || "OBSERVATION_ERROR", message: "Observation attempt failed" };
        job.state = job.attempts < attemptLimit(job) ? "RETRY_WAIT" : "FAILED";
        job.nextAttemptAt = nextRetry(job);
      }
      if (terminal.has(job.state) && job.coalesceKey && activeJobsByCoalesceKey.get(job.coalesceKey)?.jobId === job.jobId) activeJobsByCoalesceKey.delete(job.coalesceKey);
      if (store?.saveJob) await store.saveJob(job);
    }
    return due;
  }
  function retryPlan(job) {
    const plan = retryPolicy?.(job.input) ?? null;
    if (plan && (!Number.isSafeInteger(plan.maxAttempts) || plan.maxAttempts < 1)) throw new TypeError("Observation retry policy must return a positive maxAttempts");
    return plan;
  }
  function attemptLimit(job) {
    return retryPlan(job)?.maxAttempts ?? maxAttempts;
  }
  function nextRetry(job) {
    const plan = retryPlan(job);
    const delay = plan ? plan.retryDelayMs(job.attempts) : retryDelayMs * Math.min(2 ** Math.max(0, job.attempts - 1), 32);
    if (!Number.isSafeInteger(delay) || delay < 0) throw new TypeError("Observation retry policy must return a non-negative integer delay");
    return clock() + Math.floor(delay * (0.75 + jitter() * 0.5));
  }
  return { enqueue, enqueuePersistent, get(jobId) {
    return store?.getJob ? store.getJob(jobId) : jobs.get(jobId);
  }, list() {
    return store?.listJobs ? store.listJobs() : [...jobs.values()];
  }, runOnce, runJob, start(intervalMs = retryDelayMs) {
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
  chainObservationRetryPolicy,
  createObservationWorker
};
