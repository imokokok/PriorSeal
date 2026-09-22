// Generated from cloudflare-retry.mts by npm run core:build. Do not edit directly.
const REDELIVERABLE_JOB_STATES = /* @__PURE__ */ new Set(["QUEUED", "RUNNING", "RETRY_WAIT"]);
function shouldRedeliverJob(job) {
  return Boolean(job && REDELIVERABLE_JOB_STATES.has(job.state));
}
function retryDelaySeconds(jobs, { now = Date.now(), runningDelaySeconds = 30 } = {}) {
  if (!jobs.length) return null;
  const nextAttemptAt = Math.min(...jobs.map((job) => job.state === "RUNNING" || !Number.isFinite(job.nextAttemptAt) ? now + runningDelaySeconds * 1e3 : job.nextAttemptAt));
  return Math.max(1, Math.min(86400, Math.ceil((nextAttemptAt - now) / 1e3)));
}
export {
  retryDelaySeconds,
  shouldRedeliverJob
};
