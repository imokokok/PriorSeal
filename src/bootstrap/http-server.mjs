import { createHttpServer } from '../interfaces/http/create-http-server.mjs';
import { createKeyRegistry } from '../domain/key-registry.mjs';
import { createFileKeyProvider } from '../infrastructure/keys/file-key-provider.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';

const config = loadRuntimeConfig();
const keyProvider = createFileKeyProvider({ privateKeyFile: config.privateKeyFile, publicKeyFile: config.publicKeyFile });
const privateKeyPem = keyProvider.getPrivateKey();
const publicKeyPem = keyProvider.getPublicKey();
const registry = createKeyRegistry(publicKeyPem ? [{ issuer: config.issuer, keyId: config.keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active' }] : []);
const server = createHttpServer({ issuer: config.issuer, keyId: config.keyId, privateKeyPem, publicKeyPem, keyRegistry: registry, corsOrigins: config.corsOrigins, trustProxy: config.trustProxy });
server.listen(config.port, () => console.log(JSON.stringify({ level: 'info', event: 'server.started', port: config.port })));
function shutdown(signal) { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); }
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
