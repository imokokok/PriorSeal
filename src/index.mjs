/** Public, stable library surface. Internal modules are intentionally not re-exported. */
export { createHttpServer } from './interfaces/http/create-http-server.mjs';
export { createObservationWorker } from './application/observations/observation-worker.mjs';
export { createMemoryStore } from './infrastructure/persistence/memory-store.mjs';
export { createPostgresStore } from './infrastructure/persistence/postgres-store.mjs';
export { buildIntent } from './domain/intent.mjs';
export { buildReceipt, signReceipt, verifySignature } from './domain/receipt.mjs';
export { verifyReceipt } from './domain/receipt-verifier.mjs';
export { createKeyRegistry } from './domain/key-registry.mjs';
export { canonicalize, hashJson, sha256Hex } from './domain/canonical-json.mjs';
