import { httpServerHandler } from 'cloudflare:node';
import { createPriorSealRuntime, createPriorSealBackgroundRuntime } from './create-runtime.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';
import { retryDelaySeconds } from './cloudflare-retry.mjs';
import { processObservationQueue } from './cloudflare-observations.mjs';
import { cloudflareRuntimeEnvironment, createCloudflareRateLimiter, evidenceBucketBinding } from './cloudflare-bindings.mjs';
import { reconcileEvidenceArchiveOutbox } from '../infrastructure/persistence/evidence-r2.mjs';
import { errorMessage } from '../shared/error-code.mjs';
import { createSchemaCapabilityGuard } from './cloudflare-schema.mjs';
import type { ObservationJob } from '../application/observations/observation-worker.mjs';

type Runtime = Awaited<ReturnType<typeof createPriorSealRuntime>>;
const assertSchemaCapability = createSchemaCapabilityGuard();

const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-permitted-cross-domain-policies': 'none',
});

const TELEGRAM_MINI_APP_PATHS = new Set(['/app/lending', '/app/lending/']);
const TELEGRAM_MINI_APP_SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org; form-action 'self'",
});

function withSecurityHeaders(response: Response, pathname?: string) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (pathname && TELEGRAM_MINI_APP_PATHS.has(pathname)) {
    for (const [name, value] of Object.entries(TELEGRAM_MINI_APP_SECURITY_HEADERS)) headers.set(name, value);
    // X-Frame-Options cannot express the Telegram-only allowlist. CSP frame-ancestors
    // above remains restrictive while allowing the Telegram Web Mini App host.
    headers.delete('x-frame-options');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isWorkerRoute(pathname: string) {
  // Static ownership-verification files are served from web/dist via ASSETS;
  // everything else under /.well-known/ belongs to the API router.
  if (pathname === '/.well-known/sati-agent.json') return false;
  if (pathname === '/.well-known/mcp-registry-auth') return false;
  if (pathname === '/.well-known/glama.json') return false;
  return pathname === '/i'
    || pathname === '/mcp'
    || pathname.startsWith('/v1/')
    || pathname.startsWith('/health/')
    || pathname.startsWith('/.well-known/')
    || pathname.startsWith('/openapi/')
    || pathname === '/openapi.json';
}

function httpsRedirect(request: Request) {
  const target = new URL(request.url);
  if (target.protocol === 'https:') return null;
  target.protocol = 'https:';
  return withSecurityHeaders(new Response(null, { status: 301, headers: { 'cache-control': 'no-store', location: target.toString() } }));
}

async function withRuntime<T, R extends { server?: Runtime['server'] }>(environment: Env, context: ExecutionContext, createRuntime: (options: Parameters<typeof createPriorSealRuntime>[0]) => Promise<R>, operation: (runtime: R) => Promise<T>): Promise<T> {
  const runtimeEnvironment = cloudflareRuntimeEnvironment(environment);
  const config = loadRuntimeConfig(runtimeEnvironment);
  const evidenceBucket = evidenceBucketBinding(environment);
  let runtime: R | undefined;
  try {
    await assertSchemaCapability(environment.DB);
    runtime = await createRuntime({
      config,
      environment: runtimeEnvironment,
      d1: environment.DB,
      evidenceBucket,
      assertSchema: false,
      rateLimiter: createCloudflareRateLimiter(environment.HTTP_RATE_LIMITER),
      logger: {
        error: (entry) => console.error(JSON.stringify({ level: 'error', ...entry })),
        info: (entry) => console.log(JSON.stringify({ level: 'info', ...entry })),
      },
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
  return withSecurityHeaders(Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service initialization failed', requestId } }, { status: 503, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } }));
}

export default {
  async fetch(request: Request, environment: Env, context: ExecutionContext): Promise<Response> {
    const telegramMiniAppPath = new URL(request.url).pathname;
    if (TELEGRAM_MINI_APP_PATHS.has(telegramMiniAppPath) && !httpsRedirect(request)) {
      return withSecurityHeaders(await environment.ASSETS.fetch(request), telegramMiniAppPath);
    }
    const redirect = httpsRedirect(request);
    if (redirect) return redirect;
    const pathname = new URL(request.url).pathname;
    if (!isWorkerRoute(pathname)) return withSecurityHeaders(await environment.ASSETS.fetch(request));
    try {
      const response = await withRuntime(environment, context, createPriorSealRuntime, async (runtime) => {
        // The Node adapter's declared server and request shapes are narrower than
        // the Node Server and Worker Request values it receives at runtime.
        const handler = httpServerHandler(runtime.server as unknown as Parameters<typeof httpServerHandler>[0]);
        if (!handler.fetch) throw new TypeError('Cloudflare Node HTTP handler is unavailable');
        return handler.fetch(request as unknown as Parameters<typeof handler.fetch>[0], environment, context);
      });
      return withSecurityHeaders(response);
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
      const bucket = evidenceBucketBinding(environment);
      if (bucket) {
        try {
          await reconcileEvidenceArchiveOutbox({ database: environment.DB, bucket, now: Date.now() });
        } catch (error) {
          console.error(JSON.stringify({ level: 'error', event: 'evidence.reconcile_failed', message: errorMessage(error) }));
        }
      }
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
