// Generated from http-server.mts by npm run core:build. Do not edit directly.
import { resolve } from "node:path";
import { isIP } from "node:net";
import { createPriorSealRuntime } from "./create-runtime.mjs";
import { loadRuntimeConfig } from "./runtime-config.mjs";
const config = loadRuntimeConfig();
const { server, pool, observationWorker } = await createPriorSealRuntime({ config, staticDir: resolve("web/dist") });
const stopWorker = observationWorker?.start();
const host = process.env.PRIORSEAL_LISTEN_HOST?.trim() || "0.0.0.0";
if (isIP(host) === 0) throw new TypeError("PRIORSEAL_LISTEN_HOST must be an IPv4 or IPv6 address");
server.listen(config.port, host, () => console.log(JSON.stringify({ level: "info", event: "server.started", host, port: config.port, storage: pool ? "postgresql" : "memory" })));
function shutdown() {
  stopWorker?.();
  server.close(() => {
    if (!pool) return process.exit(0);
    pool.end().then(() => process.exit(0), () => process.exit(1));
  });
  setTimeout(() => process.exit(1), 1e4).unref();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
