import { resolve } from 'node:path';
import { createPriorSealRuntime } from './create-runtime.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';

const config = loadRuntimeConfig();
const { server, pool, observationWorker } = await createPriorSealRuntime({ config, staticDir: resolve('web/dist') });
const stopWorker = observationWorker?.start();

server.listen(config.port, () => console.log(JSON.stringify({ level: 'info', event: 'server.started', port: config.port, storage: pool ? 'postgresql' : 'memory' })));

function shutdown() {
  stopWorker?.();
  server.close(() => {
    if (!pool) return process.exit(0);
    pool.end().then(() => process.exit(0), () => process.exit(1));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
