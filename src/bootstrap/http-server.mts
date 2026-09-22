import pg from 'pg';
import { resolve } from 'node:path';
import { createHttpServer } from '../interfaces/http/create-http-server.mjs';
import { createKeyRegistry } from '../domain/key-registry.mjs';
import { createFileKeyProvider } from '../infrastructure/keys/file-key-provider.mjs';
import { parseKeyRegistryDocument, readFileKeyRegistry } from '../infrastructure/keys/file-key-registry.mjs';
import { createPostgresStore } from '../infrastructure/persistence/postgres-store.mjs';
import { createRpcClient } from '../infrastructure/blockchain/evm/rpc-client.mjs';
import { getRpcUrls, SUPPORTED_CHAINS } from '../infrastructure/blockchain/evm/chains.mjs';
import { PriorSealError } from '../domain/errors.mjs';
import { parsePolicyDocument, readPolicyFile } from '../infrastructure/policy/file-policy-provider.mjs';
import { createObservationWorker } from '../application/observations/observation-worker.mjs';
import { observeExecution } from '../application/observations/observe-execution.mjs';
import { observeEvm } from '../infrastructure/blockchain/evm/observer.mjs';
import { parseTransparencyAnchor, readTransparencyAnchor, verifyTransparencyAnchor } from '../infrastructure/transparency/file-anchor-provider.mjs';
import { buildMerkleTransparencyEvidence, buildTransparencyEvidence } from '../domain/transparency.mjs';
import { createHttpWitnessProvider, parseWitnessEndpoints, readWitnessEndpoints } from '../infrastructure/witness/http-witness-client.mjs';
import { createDigiCertTimestampProvider } from '../infrastructure/timestamp/digicert-rfc3161-client.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';
import { assertProductionSchema } from './production-schema.mjs';
import { createContractSignatureVerifier } from '../infrastructure/blockchain/evm/contract-signature-verifier.mjs';
import { assertEd25519KeyPair } from '../domain/ed25519.mjs';
import type { AuthorizationAcceptance } from '../domain/authorization.mjs';
import type { ObservationWorkInput } from '../application/observations/observation-worker.mjs';

const { Pool } = pg;
const config = loadRuntimeConfig();
const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : null;
if (config.environment === 'production') await assertProductionSchema(pool, { preExecutionProofMode: config.preExecutionProofMode, archiveEnabled: Boolean(config.archiveCredentials) });
const store = pool ? createPostgresStore(pool) : undefined;
const keyProvider = createFileKeyProvider({ privateKeyFile: config.privateKeyFile, publicKeyFile: config.publicKeyFile });
const privateKeyPem = config.privateKeyPem ?? keyProvider.getPrivateKey();
const publicKeyPem = config.publicKeyPem ?? keyProvider.getPublicKey();
if (privateKeyPem || publicKeyPem) {
  if (!privateKeyPem || !publicKeyPem) throw new TypeError('Issuer private and public keys must be configured together');
  assertEd25519KeyPair(privateKeyPem, publicKeyPem);
}
const registry = createKeyRegistry(config.keyRegistryJson ? parseKeyRegistryDocument(config.keyRegistryJson) : readFileKeyRegistry(config.keyRegistryFile));
const policy = config.policyJson ? parsePolicyDocument(config.policyJson) : readPolicyFile(config.policyFile);
if (config.environment === 'production' && !config.allowSelfAssertedPrincipals && !policy?.principals?.length) throw new TypeError('Production policy must contain at least one reviewed principal or explicitly allow self-asserted principals');
if (config.preExecutionProofMode === 'witness-quorum' && !policy?.witnessQuorum) throw new TypeError('Witness-quorum mode requires witnessQuorum in the signed authorization policy');
if (config.preExecutionProofMode === 'rfc3161' && !policy?.timestampPolicy) throw new TypeError('RFC 3161 mode requires timestampPolicy in the signed authorization policy');
const witnessEndpoints = config.witnessEndpointsJson ? parseWitnessEndpoints(config.witnessEndpointsJson, { requireHttps: config.environment === 'production' }) : readWitnessEndpoints(config.witnessEndpointsFile, { requireHttps: config.environment === 'production' });
const witnessProvider = config.preExecutionProofMode === 'witness-quorum' ? createHttpWitnessProvider({ policy: policy?.witnessQuorum, endpoints: witnessEndpoints, requester: config.issuer }) : null;
const timestampProvider = config.preExecutionProofMode === 'rfc3161' ? createDigiCertTimestampProvider() : null;
const rpcClient = createRpcClient();
const loadTransparencyAnchor = async () => {
  const candidate = config.transparencyAnchorJson ? parseTransparencyAnchor(config.transparencyAnchorJson) : readTransparencyAnchor(config.transparencyAnchorFile);
  return verifyTransparencyAnchor(candidate, { rpcClient, rpcUrls: getRpcUrls(candidate?.chainId ?? -1) ?? [], minConfirmations: config.anchorConfirmations });
};
if (config.transparencyAnchorFile || config.transparencyAnchorJson) await loadTransparencyAnchor();
const verifyContractSignature = createContractSignatureVerifier({ rpcClient, rpcUrls: (chainId: number) => getRpcUrls(chainId) ?? [] });
if (publicKeyPem) registry.add({ issuer: config.issuer, keyId: config.keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active', validFrom: null, validUntil: null });
const transparencyProvider = store && privateKeyPem ? async (acceptance: AuthorizationAcceptance, { before }: { before?: number } = {}) => {
  const anchor = await loadTransparencyAnchor();
  const coveringAnchor = anchor && anchor.size >= acceptance.sequence ? anchor : null;
  const parameters = { acceptance, issuer: config.issuer, keyId: config.keyId, privateKeyPem, issuedAt: Math.floor(Date.now() / 1000), anchor: coveringAnchor, before };
  const evidence = coveringAnchor && !coveringAnchor.merkleRoot
    ? buildTransparencyEvidence({ ...parameters, entries: await store.listAuthorizationLog() })
    : buildMerkleTransparencyEvidence({ ...parameters, snapshot: await store.getAuthorizationMerkleSnapshot(acceptance, coveringAnchor?.size ?? null) });
  if (config.requireExternalAnchor && !evidence.checkpoint.anchor) throw new PriorSealError('TRANSPARENCY_ANCHOR_REQUIRED', 'A verified external anchor covering this authorization is required before execution');
  return evidence;
} : null;
const worker = store ? createObservationWorker({ store, observe: async (input: ObservationWorkInput) => (await observeExecution({ input, store, observer: observeEvm, privateKeyPem, publicKeyPem, issuer: config.issuer, keyId: config.keyId, transparencyProvider, authorizationAudience: config.authorizationAudience, verifyContractSignature })).response, saveObservation: (observation) => store.saveObservation(observation as Parameters<typeof store.saveObservation>[0]) }) : null;
const stopWorker = worker?.start();
const server = createHttpServer({ archiveCredentials: config.archiveCredentials, proofMode: config.preExecutionProofMode, rpcChainIds: Object.keys(SUPPORTED_CHAINS).map(Number).filter(id => (getRpcUrls(id) ?? []).length > 0), store, issuer: config.issuer, keyId: config.keyId, privateKeyPem, publicKeyPem, keyRegistry: registry, policy, authorizationAudience: config.authorizationAudience, verifyContractSignature, timestampProvider, requireTimestamp: config.preExecutionProofMode === 'rfc3161', witnessProvider, requireWitnessQuorum: config.preExecutionProofMode === 'witness-quorum', transparencyProvider, observationWorker: worker, corsOrigins: config.corsOrigins, trustProxy: config.trustProxy, version: config.buildVersion, staticDir: resolve('web/dist') });
server.listen(config.port, () => console.log(JSON.stringify({ level: 'info', event: 'server.started', port: config.port, storage: pool ? 'postgresql' : 'memory' })));
function shutdown(signal: NodeJS.Signals) {
  stopWorker?.();
  server.close(() => {
    if (!pool) return process.exit(0);
    pool.end().then(() => process.exit(0), () => process.exit(1));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
