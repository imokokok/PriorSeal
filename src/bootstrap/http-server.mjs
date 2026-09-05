import pg from 'pg';
import { createHttpServer } from '../interfaces/http/create-http-server.mjs';
import { createKeyRegistry } from '../domain/key-registry.mjs';
import { createFileKeyProvider } from '../infrastructure/keys/file-key-provider.mjs';
import { createPostgresStore } from '../infrastructure/persistence/postgres-store.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';

const { Pool } = pg;
const config = loadRuntimeConfig();
const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : null;
const store = pool ? createPostgresStore(pool) : undefined;
const keyProvider = createFileKeyProvider({ privateKeyFile: config.privateKeyFile, publicKeyFile: config.publicKeyFile });
const privateKeyPem = keyProvider.getPrivateKey();
const publicKeyPem = keyProvider.getPublicKey();
const registry = createKeyRegistry(publicKeyPem ? [{ issuer: config.issuer, keyId: config.keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active' }] : []);
const server = createHttpServer({ store, issuer: config.issuer, keyId: config.keyId, privateKeyPem, publicKeyPem, keyRegistry: registry, corsOrigins: config.corsOrigins, trustProxy: config.trustProxy });
server.listen(config.port, () => console.log(JSON.stringify({ level: 'info', event: 'server.started', port: config.port, storage: pool ? 'postgresql' : 'memory' })));
function shutdown(signal) {
  server.close(() => {
    if (!pool) return process.exit(0);
    pool.end().then(() => process.exit(0), () => process.exit(1));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
