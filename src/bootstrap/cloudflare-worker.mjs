import pg from 'pg';
import { httpServerHandler } from 'cloudflare:node';
import { createPriorSealRuntime } from './create-runtime.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';
import { assertProductionSchema, REQUIRED_PRODUCTION_MIGRATION } from './production-schema.mjs';
import { retryDelaySeconds, shouldRedeliverJob } from './cloudflare-retry.mjs';

const { Client } = pg;

function databaseAdapter(client) {
  const query = client.query.bind(client);
  return {
    query,
    async connect() { return { query, release() {} }; },
  };
}

async function assertSchemaCached(database, config, context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://priorseal.internal/schema/${REQUIRED_PRODUCTION_MIGRATION}/${config.preExecutionProofMode}`);
  if (await cache.match(cacheKey)) return;
  await assertProductionSchema(database, { preExecutionProofMode: config.preExecutionProofMode });
  context.waitUntil(cache.put(cacheKey, new Response('ready', { headers: { 'cache-control': 'public, max-age=300' } })));
}

async function withRuntime(environment, context, operation) {
  if (!environment.HYPERDRIVE?.connectionString) throw new TypeError('HYPERDRIVE binding is required');
  if (!environment.OBSERVATION_QUEUE?.send) throw new TypeError('OBSERVATION_QUEUE binding is required');
  const config = loadRuntimeConfig({ ...environment, PRIORSEAL_RUNTIME: 'cloudflare-workers', DATABASE_URL: environment.HYPERDRIVE.connectionString });
  const client = new Client({ connectionString: environment.HYPERDRIVE.connectionString });
  await client.connect();
  const database = databaseAdapter(client);
  let runtime;
  try {
    await assertSchemaCached(database, config, context);
    runtime = await createPriorSealRuntime({
      config,
      environment,
      database,
      assertSchema: false,
      dispatchObservationJob: (job) => environment.OBSERVATION_QUEUE.send({ jobId: job.jobId }),
    });
    return await operation(runtime);
  } finally {
    if (runtime?.server.listening) await new Promise((resolve) => runtime.server.close(resolve));
    await client.end().catch(() => {});
  }
}

function unavailable(error) {
  const requestId = crypto.randomUUID();
  console.error(JSON.stringify({ level: 'error', event: 'worker.request_failed', requestId, message: String(error?.message ?? error) }));
  return Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service initialization failed', requestId } }, { status: 503, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId } });
}

export default {
  async fetch(request, environment, context) {
    try {
      return await withRuntime(environment, context, async (runtime) => httpServerHandler(runtime.server).fetch(request, environment, context));
    } catch (error) {
      return unavailable(error);
    }
  },

  async queue(batch, environment, context) {
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
        await environment.OBSERVATION_QUEUE.send({ jobId: job.jobId }, { delaySeconds: retryDelaySeconds([job]) });
      }
      batch.ackAll();
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'observation.queue_failed', message: String(error?.message ?? error) }));
      batch.retryAll({ delaySeconds: 30 });
    }
  },

  async scheduled(_controller, environment, context) {
    context.waitUntil(withRuntime(environment, context, async (runtime) => {
      const jobs = await runtime.baseObservationWorker?.runOnce() ?? [];
      for (const job of jobs.filter((candidate) => candidate.state === 'RETRY_WAIT')) {
        await environment.OBSERVATION_QUEUE.send({ jobId: job.jobId }, { delaySeconds: retryDelaySeconds([job]) });
      }
    }).catch((error) => {
      console.error(JSON.stringify({ level: 'error', event: 'observation.schedule_failed', message: String(error?.message ?? error) }));
      throw error;
    }));
  },
};
