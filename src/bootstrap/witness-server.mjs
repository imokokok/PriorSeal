import pg from 'pg';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { statSync } from 'node:fs';
import { createFileKeyProvider } from '../infrastructure/keys/file-key-provider.mjs';
import { createPostgresWitnessStore } from '../infrastructure/witness/postgres-witness-store.mjs';
import { createWitnessHttpServer } from '../interfaces/http/create-witness-http-server.mjs';

const { Pool } = pg;
const environment = process.env.RUNPROOF_ENVIRONMENT ?? 'development';
const port = integer(process.env.PORT ?? '3101', 'PORT', 1, 65_535);
const witnessId = required(process.env.RUNPROOF_WITNESS_ID, 'RUNPROOF_WITNESS_ID');
const keyId = required(process.env.RUNPROOF_WITNESS_KEY_ID, 'RUNPROOF_WITNESS_KEY_ID');
const privateKeyFile = required(process.env.RUNPROOF_WITNESS_PRIVATE_KEY_FILE, 'RUNPROOF_WITNESS_PRIVATE_KEY_FILE');
const publicKeyFile = required(process.env.RUNPROOF_WITNESS_PUBLIC_KEY_FILE, 'RUNPROOF_WITNESS_PUBLIC_KEY_FILE');
const databaseUrl = process.env.DATABASE_URL?.trim();
if (environment === 'production' && !databaseUrl) throw new TypeError('Production witness requires DATABASE_URL');
if (environment === 'production' && !process.env.RUNPROOF_WITNESS_BEARER_TOKEN) throw new TypeError('Production witness requires RUNPROOF_WITNESS_BEARER_TOKEN');
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const keys = createFileKeyProvider({ privateKeyFile, publicKeyFile });
const privateKeyPem = keys.getPrivateKey();
const publicKeyPem = keys.getPublicKey();
const privateKey = createPrivateKey(privateKeyPem);
const configuredPublicKey = createPublicKey(publicKeyPem);
if (privateKey.asymmetricKeyType !== 'ed25519' || configuredPublicKey.asymmetricKeyType !== 'ed25519') throw new TypeError('Witness keys must be Ed25519');
const derivedPublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
if (!derivedPublicKey.equals(configuredPublicKey.export({ type: 'spki', format: 'der' }))) throw new TypeError('Witness private and public keys do not match');
if (environment === 'production' && (statSync(privateKeyFile).mode & 0o077) !== 0) throw new TypeError('Witness private key must not be readable by group or others');
const server = createWitnessHttpServer({
  witnessId,
  keyId,
  privateKeyPem,
  publicKeyPem,
  ...(pool ? { store: createPostgresWitnessStore(pool) } : {}),
  bearerToken: process.env.RUNPROOF_WITNESS_BEARER_TOKEN,
  maxRequestAgeSeconds: integer(process.env.RUNPROOF_WITNESS_MAX_REQUEST_AGE_SECONDS ?? '300', 'RUNPROOF_WITNESS_MAX_REQUEST_AGE_SECONDS', 1, 3600),
});
server.listen(port, () => console.log(JSON.stringify({ level: 'info', event: 'witness.started', witnessId, port, storage: pool ? 'postgresql' : 'memory' })));

function shutdown() { server.close(() => pool ? pool.end().finally(() => process.exit(0)) : process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); }
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);

function required(value, name) { if (!value?.trim()) throw new TypeError(`${name} is required`); return value.trim(); }
function integer(value, name, min, max) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new TypeError(`${name} must be an integer between ${min} and ${max}`); return parsed; }
