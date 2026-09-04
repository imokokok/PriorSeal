import { createApiServer } from './server.mjs';
import { createKeyRegistry } from '../../core/keys.mjs';
import { createFileKeyProvider } from '../../infrastructure/keys/file-key-provider.mjs';

const port = Number(process.env.PORT ?? 3000);
const issuer = process.env.RUNPROOF_ISSUER ?? 'runproof-local';
const keyId = process.env.RUNPROOF_KEY_ID ?? 'default';
const privateKeyPath = process.env.RUNPROOF_PRIVATE_KEY_FILE;
const publicKeyPath = process.env.RUNPROOF_PUBLIC_KEY_FILE;
const keyProvider = createFileKeyProvider({ privateKeyFile: privateKeyPath, publicKeyFile: publicKeyPath });
const privateKeyPem = keyProvider.getPrivateKey();
const publicKeyPem = keyProvider.getPublicKey();
const registry = createKeyRegistry(publicKeyPem ? [{ issuer, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active' }] : []);
const server = createApiServer({ issuer, keyId, privateKeyPem, publicKeyPem, keyRegistry, corsOrigins: (process.env.RUNPROOF_CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean), trustProxy: process.env.RUNPROOF_TRUST_PROXY === 'true' });
server.listen(port, () => console.log(JSON.stringify({ level: 'info', event: 'server.started', port })));
function shutdown(signal) { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); }
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
