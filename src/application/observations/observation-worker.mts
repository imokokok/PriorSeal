import { errorCode } from '../../shared/error-code.mjs';
import { randomUUID } from 'node:crypto';
import { detectReorg } from '../../domain/execution.mjs';

const retryable = new Set(['PENDING', 'NOT_FOUND', 'RPC_ERROR', 'RPC_TIMEOUT']);
type ObservationWork = { chainId?: number | string; txHash: string; confirmations?: number; [field: string]: unknown };
export type ObservationWorkInput = ObservationWork & { idempotencyKey?: string; coalesceKey?: string };
export type WorkerObservation = { status: string; txHash: string; blockHash?: string | null; finalityState?: string; previousBlockHash?: string | null; [field: string]: unknown };
export type ObservationJob = { jobId: string; key?: string; idempotencyKey?: string; coalesceKey?: string; input: ObservationWork; state: string; attempts: number; createdAt: number; nextAttemptAt: number; updatedAt?: number; observation: WorkerObservation | null; result: ({ observation: WorkerObservation } & Record<string, unknown>) | null; error: { code: string; message: string } | null; leaseToken?: string };
export type ObservationRetryPlan = { maxAttempts: number; retryDelayMs: (attempt: number) => number };

const SOLANA_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 90_000, 180_000];
const EVM_RETRY_DELAYS_MS = [8_000, 24_000, 72_000, 180_000];
const terminal = new Set(['COMPLETED', 'UNDETERMINED', 'FAILED']);

/**
 * Keep a bounded observation window per chain family. The first observation is
 * synchronous; this plan applies only to queued follow-ups after it is pending.
 */
export function chainObservationRetryPolicy(input: ObservationWork): ObservationRetryPlan {
  const delays = Number(input.chainId) === 0 ? SOLANA_RETRY_DELAYS_MS : EVM_RETRY_DELAYS_MS;
  return { maxAttempts: delays.length + 1, retryDelayMs: (attempt) => delays[Math.min(Math.max(0, attempt - 1), delays.length - 1)] };
}
type ObservationJobStore = {
  enqueueJob?: (job: ObservationJob) => Promise<ObservationJob>;
  claimDueJobs?: (now: number, limit: number, leaseMs: number) => Promise<ObservationJob[]>;
  claimJob?: (jobId: string, now: number, leaseMs: number) => Promise<ObservationJob | undefined>;
  saveJob?: (job: ObservationJob) => Promise<unknown>;
  getJob?: (jobId: string) => Promise<ObservationJob | undefined>;
  listJobs?: () => Promise<ObservationJob[]>;
  getObservation?: (chainId: number | string | undefined, txHash: string) => Promise<WorkerObservation | null | undefined>;
};
export function createObservationWorker({ observe, saveObservation, observerManagesEvidence = false, store = null, clock = () => Date.now(), retryDelayMs = 5000, maxAttempts = 8, retryPolicy, jobLeaseMs = 15 * 60_000, jitter = () => 0.5 }: { observe: (input: ObservationWork) => Promise<unknown>; saveObservation: (observation: WorkerObservation) => Promise<unknown>; observerManagesEvidence?: boolean; store?: ObservationJobStore | null; clock?: () => number; retryDelayMs?: number; maxAttempts?: number; retryPolicy?: (input: ObservationWork) => ObservationRetryPlan; jobLeaseMs?: number; jitter?: () => number }) {
  if (typeof observe !== 'function' || typeof saveObservation !== 'function') throw new TypeError('observe and saveObservation are required');
  const jobs = new Map<string, ObservationJob>();
  // Keep completed jobs indexed too: explicit idempotency keys remain stable for
  // the worker's lifetime, while coalesce keys only deduplicate active work.
  const jobsByKey = new Map<string, ObservationJob>();
  const activeJobsByCoalesceKey = new Map<string, ObservationJob>();
  async function enqueuePersistent(input: ObservationWorkInput) {
    if (!store?.enqueueJob) return enqueue(input);
    const { idempotencyKey, coalesceKey, ...workInput } = input;
    const naturalKey = `${input.chainId}:${input.txHash}:${input.confirmations ?? 0}`;
    const now = clock(); const job: ObservationJob = { jobId: randomUUID(), idempotencyKey: idempotencyKey || naturalKey, coalesceKey: coalesceKey || naturalKey, input: workInput, state: 'QUEUED', attempts: 0, createdAt: now, nextAttemptAt: now, observation: null, result: null, error: null };
    return store.enqueueJob(job);
  }
  function enqueue(input: ObservationWorkInput) {
    const { idempotencyKey, coalesceKey, ...workInput } = input; const naturalKey = `${input.chainId}:${input.txHash}:${input.confirmations ?? 0}`; const key = idempotencyKey || naturalKey; const activeKey = coalesceKey || naturalKey;
    const existing = jobsByKey.get(key);
    if (existing) return existing;
    const active = activeJobsByCoalesceKey.get(activeKey);
    if (active && !terminal.has(active.state)) return active;
    const job: ObservationJob = { jobId: randomUUID(), key, idempotencyKey: key, coalesceKey: activeKey, input: workInput, state: 'QUEUED', attempts: 0, createdAt: clock(), nextAttemptAt: clock(), observation: null, result: null, error: null };
    jobs.set(job.jobId, job); jobsByKey.set(key, job); activeJobsByCoalesceKey.set(activeKey, job); return job;
  }
  async function runOnce() {
    const persistentClaims = Boolean(store?.claimDueJobs);
    const due = store?.claimDueJobs ? await store.claimDueJobs(clock(), 10, jobLeaseMs) : [...jobs.values()].filter((job) => ['QUEUED', 'RETRY_WAIT'].includes(job.state) && job.nextAttemptAt <= clock());
    return processJobs(due, persistentClaims);
  }
  async function runJob(jobId: string) {
    if (store?.claimDueJobs && !store.claimJob) throw new TypeError('Targeted observation requires atomic claimJob support');
    const job = store?.claimJob ? await store.claimJob(jobId, clock(), jobLeaseMs) : jobs.get(jobId);
    // A duplicate prompt may arrive before its retry window. Return its
    // persisted state only in that no-claim path so Queue can retain the
    // intended delay without adding a second read to actual executions.
    if (!job && store?.claimJob) return store.getJob?.(jobId);
    const due = job && (store?.claimJob || ['QUEUED', 'RETRY_WAIT'].includes(job.state) && job.nextAttemptAt <= clock()) ? [job] : [];
    return (await processJobs(due, Boolean(store?.claimJob)))[0] ?? job;
  }
  async function processJobs(due: ObservationJob[], persistentClaims: boolean) {
    for (const job of due) {
      job.state = 'RUNNING'; if (!persistentClaims) job.attempts += 1;
      try {
        // The application observer owns reorg detection and the atomic evidence
        // transaction when enabled; do not mutate its already-signed result.
        const previous = observerManagesEvidence ? null : job.observation ?? (store?.getObservation ? await store.getObservation(job.input.chainId, job.input.txHash) : null);
        const observed = await observe(job.input);
        const result = isObservationResult(observed) ? observed : null;
        const observation = result?.observation ?? observed;
        if (!isWorkerObservation(observation)) throw new TypeError('Observer returned an invalid observation');
        if (!observerManagesEvidence && detectReorg(previous, observation)) { observation.status = 'REORGED'; observation.finalityState = 'REORGED'; observation.previousBlockHash = previous?.blockHash; }
        job.observation = observation; job.result = result ? { ...result, observation } : null;
        if (!observerManagesEvidence) await saveObservation(observation);
        job.error = null;
        if (retryable.has(observation.status) && job.attempts < attemptLimit(job)) { job.state = 'RETRY_WAIT'; job.nextAttemptAt = nextRetry(job); }
        else { job.state = observation.status === 'CONFIRMED' || observation.status === 'REVERTED' ? 'COMPLETED' : 'UNDETERMINED'; }
      } catch (error) {
        job.error = { code: errorCode(error) || 'OBSERVATION_ERROR', message: 'Observation attempt failed' }; job.state = job.attempts < attemptLimit(job) ? 'RETRY_WAIT' : 'FAILED'; job.nextAttemptAt = nextRetry(job);
      }
      if (terminal.has(job.state) && job.coalesceKey && activeJobsByCoalesceKey.get(job.coalesceKey)?.jobId === job.jobId) activeJobsByCoalesceKey.delete(job.coalesceKey);
      if (store?.saveJob) await store.saveJob(job);
    }
    return due;
  }
  function retryPlan(job: ObservationJob): ObservationRetryPlan | null {
    const plan = retryPolicy?.(job.input) ?? null;
    if (plan && (!Number.isSafeInteger(plan.maxAttempts) || plan.maxAttempts < 1)) throw new TypeError('Observation retry policy must return a positive maxAttempts');
    return plan;
  }
  function attemptLimit(job: ObservationJob) { return retryPlan(job)?.maxAttempts ?? maxAttempts; }
  function nextRetry(job: ObservationJob) {
    const plan = retryPlan(job);
    const delay = plan ? plan.retryDelayMs(job.attempts) : retryDelayMs * Math.min(2 ** Math.max(0, job.attempts - 1), 32);
    if (!Number.isSafeInteger(delay) || delay < 0) throw new TypeError('Observation retry policy must return a non-negative integer delay');
    return clock() + Math.floor(delay * (0.75 + jitter() * 0.5));
  }
  return { enqueue, enqueuePersistent, get(jobId: string) { return store?.getJob ? store.getJob(jobId) : jobs.get(jobId); }, list() { return store?.listJobs ? store.listJobs() : [...jobs.values()]; }, runOnce, runJob, start(intervalMs = retryDelayMs) { const timer = setInterval(() => { runOnce().catch(() => {}); }, intervalMs); timer.unref?.(); return () => clearInterval(timer); } };
}

function isWorkerObservation(value: unknown): value is WorkerObservation {
  return value !== null && typeof value === 'object' && typeof (value as WorkerObservation).status === 'string' && typeof (value as WorkerObservation).txHash === 'string';
}

function isObservationResult(value: unknown): value is { observation: WorkerObservation } & Record<string, unknown> {
  return value !== null && typeof value === 'object' && 'observation' in value && isWorkerObservation(value.observation);
}
