import { httpServerHandler } from 'cloudflare:node';
import { createPriorSealRuntime } from './create-runtime.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';
import { retryDelaySeconds, shouldRedeliverJob } from './cloudflare-retry.mjs';
import { cloudflareRuntimeEnvironment, createCloudflareRateLimiter } from './cloudflare-bindings.mjs';
import { errorMessage } from '../shared/error-code.mjs';
import type { ObservationJob } from '../application/observations/observation-worker.mjs';

type Runtime = Awaited<ReturnType<typeof createPriorSealRuntime>>;

async function assertSchemaCached(database: D1Database, config: ReturnType<typeof loadRuntimeConfig>, context: ExecutionContext) {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = new Request(`https://priorseal.internal/schema/d1-0001/${config.preExecutionProofMode}/${config.archiveCredentials ? 'archive' : 'public'}`);
  if (await cache.match(cacheKey)) return;
  const required = ['authorization_log', 'authorization_log_merkle_nodes', 'authorizations', 'observation_jobs', 'receipts'];
  if (config.archiveCredentials) required.push('project_evidence_archive');
  if (config.preExecutionProofMode === 'witness-quorum') required.push('witness_attestations');
  const rows = await database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${required.map(() => '?').join(',')})`).bind(...required).all<{ name: string }>();
  if (rows.results.length !== required.length) throw new TypeError('Required D1 production tables are missing');
  context.waitUntil(cache.put(cacheKey, new Response('ready', { headers: { 'cache-control': 'public, max-age=300' } })));
}

async function withRuntime<T>(environment: Env, context: ExecutionContext, operation: (runtime: Runtime) => Promise<T>): Promise<T> {
  const runtimeEnvironment = cloudflareRuntimeEnvironment(environment);
  const config = loadRuntimeConfig(runtimeEnvironment);
  let runtime: Runtime | undefined;
  try {
    await assertSchemaCached(environment.DB, config, context);
    runtime = await createPriorSealRuntime({
      config,
      environment: runtimeEnvironment,
      d1: environment.DB,
      assertSchema: false,
      rateLimiter: createCloudflareRateLimiter(environment.HTTP_RATE_LIMITER),
      dispatchObservationJob: (job: ObservationJob) => environment.OBSERVATION_QUEUE.send({ jobId: job.jobId }),
    });
    return await operation(runtime);
  } finally {
    const server = runtime?.server;
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function unavailable(error: unknown) {
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ level: 'error', event: 'worker.request_failed', requestId, message: errorMessage(error) }));
  return Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service initialization failed', requestId } }, { status: 503, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId } });
}

export default {
  async fetch(request: Request, environment: Env, context: ExecutionContext): Promise<Response> {
    try {
      return await withRuntime(environment, context, async (runtime) => {
        // The Node adapter's declared server and request shapes are narrower than
        // the Node Server and Worker Request values it receives at runtime.
        const handler = httpServerHandler(runtime.server as unknown as Parameters<typeof httpServerHandler>[0]);
        if (!handler.fetch) throw new TypeError('Cloudflare Node HTTP handler is unavailable');
        return handler.fetch(request as unknown as Parameters<typeof handler.fetch>[0], environment, context);
      });
    } catch (error) {
      return unavailable(error);
    }
  },

  async queue(batch: MessageBatch<{ jobId: string }>, environment: Env, context: ExecutionContext) {
    try {
      const promptedJobs = await withRuntime(environment, context, async (runtime) => {
        await runtime.baseObservationWorker?.runOnce();
        const jobs = await Promise.all(batch.messages.map(async (message) => {
          const jobId = message.body?.jobId;
          if (typeof jobId !== 'string' || !jobId) {
            console.warn(JSON.stringify({ level: 'warn', event: 'observation.queue_invalid_message' }));
            return null;
          }
          return runtime.baseObservationWorker?.get(jobId);
        }));
        return jobs.filter(shouldRedeliverJob);
      });
      for (const job of promptedJobs) {
        await environment.OBSERVATION_QUEUE.send({ jobId: job.jobId }, { delaySeconds: retryDelaySeconds([job]) ?? undefined });
      }
      batch.ackAll();
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'observation.queue_failed', message: errorMessage(error) }));
      batch.retryAll({ delaySeconds: 30 });
    }
  },

  async scheduled(_controller: ScheduledController, environment: Env, context: ExecutionContext) {
    context.waitUntil(withRuntime(environment, context, async (runtime) => {
      const jobs = await runtime.baseObservationWorker?.runOnce() ?? [];
      for (const job of jobs.filter((candidate) => candidate.state === 'RETRY_WAIT')) {
        await environment.OBSERVATION_QUEUE.send({ jobId: job.jobId }, { delaySeconds: retryDelaySeconds([job]) ?? undefined });
      }
    }).catch((error) => {
      console.error(JSON.stringify({ level: 'error', event: 'observation.schedule_failed', message: errorMessage(error) }));
      throw error;
    }));
  },
} satisfies ExportedHandler<Env, { jobId: string }>;
