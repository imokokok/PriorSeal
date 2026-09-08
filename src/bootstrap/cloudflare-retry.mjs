const REDELIVERABLE_JOB_STATES = new Set(['QUEUED', 'RUNNING', 'RETRY_WAIT']);

export function shouldRedeliverJob(job) {
  return Boolean(job && REDELIVERABLE_JOB_STATES.has(job.state));
}

export function retryDelaySeconds(jobs, { now = Date.now(), runningDelaySeconds = 30 } = {}) {
  if (!jobs.length) return null;
  const nextAttemptAt = Math.min(...jobs.map((job) => (
    job.state === 'RUNNING' || !Number.isFinite(job.nextAttemptAt)
      ? now + runningDelaySeconds * 1_000
      : job.nextAttemptAt
  )));
  return Math.max(1, Math.min(86_400, Math.ceil((nextAttemptAt - now) / 1_000)));
}
