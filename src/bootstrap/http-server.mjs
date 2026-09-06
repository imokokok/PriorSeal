import pg from 'pg';
import { resolve } from 'node:path';
import { createHttpServer } from '../interfaces/http/create-http-server.mjs';
import { createKeyRegistry } from '../domain/key-registry.mjs';
import { createFileKeyProvider } from '../infrastructure/keys/file-key-provider.mjs';
import { readFileKeyRegistry } from '../infrastructure/keys/file-key-registry.mjs';
import { createPostgresStore } from '../infrastructure/persistence/postgres-store.mjs';
import { createRpcClient } from '../infrastructure/blockchain/evm/rpc-client.mjs';
import { getRpcUrls } from '../infrastructure/blockchain/evm/chains.mjs';
import { erc1271CallData } from '../domain/authorization.mjs';
import { PriorSealError } from '../domain/errors.mjs';
import { readPolicyFile } from '../infrastructure/policy/file-policy-provider.mjs';
import { createObservationWorker } from '../application/observations/observation-worker.mjs';
import { observeExecution } from '../application/observations/observe-execution.mjs';
import { observeEvm } from '../infrastructure/blockchain/evm/observer.mjs';
import { readTransparencyAnchor, verifyTransparencyAnchor } from '../infrastructure/transparency/file-anchor-provider.mjs';
import { buildTransparencyEvidence } from '../domain/transparency.mjs';
import { createHttpWitnessProvider, readWitnessEndpoints } from '../infrastructure/witness/http-witness-client.mjs';
import { createDigiCertTimestampProvider } from '../infrastructure/timestamp/digicert-rfc3161-client.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';

const { Pool } = pg;
const config = loadRuntimeConfig();
const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : null;
const store = pool ? createPostgresStore(pool) : undefined;
const keyProvider = createFileKeyProvider({ privateKeyFile: config.privateKeyFile, publicKeyFile: config.publicKeyFile });
const privateKeyPem = keyProvider.getPrivateKey();
const publicKeyPem = keyProvider.getPublicKey();
const registry = createKeyRegistry(readFileKeyRegistry(config.keyRegistryFile));
const policy = readPolicyFile(config.policyFile);
if (config.environment === 'production' && !policy?.principals?.length) throw new TypeError('Production policy must contain at least one reviewed principal');
if (config.preExecutionProofMode === 'witness-quorum' && !policy?.witnessQuorum) throw new TypeError('Witness-quorum mode requires witnessQuorum in the signed authorization policy');
if (config.preExecutionProofMode === 'rfc3161' && !policy?.timestampPolicy) throw new TypeError('RFC 3161 mode requires timestampPolicy in the signed authorization policy');
const witnessEndpoints = readWitnessEndpoints(config.witnessEndpointsFile, { requireHttps: config.environment === 'production' });
const witnessProvider = config.preExecutionProofMode === 'witness-quorum' ? createHttpWitnessProvider({ policy: policy.witnessQuorum, endpoints: witnessEndpoints, requester: config.issuer }) : null;
const timestampProvider = config.preExecutionProofMode === 'rfc3161' ? createDigiCertTimestampProvider() : null;
const rpcClient = createRpcClient();
const loadTransparencyAnchor = async () => {
  const candidate = readTransparencyAnchor(config.transparencyAnchorFile);
  return verifyTransparencyAnchor(candidate, { rpcClient, rpcUrls: getRpcUrls(candidate?.chainId) ?? [] });
};
if (config.transparencyAnchorFile) await loadTransparencyAnchor();
const verifyContractSignature = async ({ authorization, digest, signature }) => {
  const urls = getRpcUrls(authorization.intent.chainId) ?? [];
  for (const url of urls) {
    try {
      const result = await rpcClient.call(url, 'eth_call', [{ to: authorization.authorizer.address, data: erc1271CallData(digest, signature) }, 'latest']);
      if (String(result).slice(0, 10).toLowerCase() === '0x1626ba7e') return true;
    } catch { /* Try the next explicitly configured source. */ }
  }
  return false;
};
if (publicKeyPem) registry.add({ issuer: config.issuer, keyId: config.keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active', validFrom: null, validUntil: null });
const transparencyProvider = store && privateKeyPem ? async (acceptance) => {
  const evidence = buildTransparencyEvidence({ entries: await store.listAuthorizationLog(), acceptance, issuer: config.issuer, keyId: config.keyId, privateKeyPem, issuedAt: Math.floor(Date.now() / 1000), anchor: await loadTransparencyAnchor() });
  if (config.requireExternalAnchor && !evidence.checkpoint.anchor) throw new PriorSealError('TRANSPARENCY_ANCHOR_REQUIRED', 'A verified external anchor covering this authorization is required before execution');
  return evidence;
} : null;
const worker = store ? createObservationWorker({ store, observe: async (input) => (await observeExecution({ input, store, observer: observeEvm, privateKeyPem, publicKeyPem, issuer: config.issuer, keyId: config.keyId, transparencyProvider, authorizationAudience: config.authorizationAudience, verifyContractSignature })).response.observation, saveObservation: (observation) => store.saveObservation(observation) }) : null;
const stopWorker = worker?.start();
const server = createHttpServer({ store, issuer: config.issuer, keyId: config.keyId, privateKeyPem, publicKeyPem, keyRegistry: registry, policy, authorizationAudience: config.authorizationAudience, verifyContractSignature, timestampProvider, requireTimestamp: config.preExecutionProofMode === 'rfc3161', witnessProvider, requireWitnessQuorum: config.preExecutionProofMode === 'witness-quorum', transparencyProvider, observationWorker: worker, corsOrigins: config.corsOrigins, trustProxy: config.trustProxy, staticDir: resolve('web/dist') });
server.listen(config.port, () => console.log(JSON.stringify({ level: 'info', event: 'server.started', port: config.port, storage: pool ? 'postgresql' : 'memory' })));
function shutdown(signal) {
  stopWorker?.();
  server.close(() => {
    if (!pool) return process.exit(0);
    pool.end().then(() => process.exit(0), () => process.exit(1));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
