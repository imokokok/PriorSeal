import { httpServerHandler } from 'cloudflare:node';
import { createPriorSealRuntime, createPriorSealBackgroundRuntime } from './create-runtime.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';
import { retryDelaySeconds } from './cloudflare-retry.mjs';
import { processObservationQueue } from './cloudflare-observations.mjs';
import { cloudflareRuntimeEnvironment, createCloudflareRateLimiter } from './cloudflare-bindings.mjs';
import { errorMessage } from '../shared/error-code.mjs';
import { createSchemaGuard } from './cloudflare-schema.mjs';
import type { ObservationJob } from '../application/observations/observation-worker.mjs';

type Runtime = Awaited<ReturnType<typeof createPriorSealRuntime>>;
const assertSchemaCached = createSchemaGuard();

async function withRuntime<T, R extends { server?: Runtime['server'] }>(environment: Env, context: ExecutionContext, createRuntime: (options: Parameters<typeof createPriorSealRuntime>[0]) => Promise<R>, operation: (runtime: R) => Promise<T>): Promise<T> {
  const runtimeEnvironment = cloudflareRuntimeEnvironment(environment);
  const config = loadRuntimeConfig(runtimeEnvironment);
  let runtime: R | undefined;
  try {
    await assertSchemaCached(environment.DB, config, context, (caches as CacheStorage & { default: Cache }).default);
    runtime = await createRuntime({
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
      return await withRuntime(environment, context, createPriorSealRuntime, async (runtime) => {
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
      await withRuntime(environment, context, createPriorSealBackgroundRuntime, async (runtime) => {
        if (!runtime.baseObservationWorker) throw new TypeError('Observation worker is unavailable');
        await processObservationQueue(batch, runtime.baseObservationWorker, environment.OBSERVATION_QUEUE);
      });
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'observation.queue_failed', message: errorMessage(error) }));
      batch.retryAll({ delaySeconds: 30 });
    }
  },

  async scheduled(_controller: ScheduledController, environment: Env, context: ExecutionContext) {
    context.waitUntil(withRuntime(environment, context, createPriorSealBackgroundRuntime, async (runtime) => {
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
