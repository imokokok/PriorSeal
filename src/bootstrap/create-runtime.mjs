import pg from 'pg';
import { createHttpServer } from '../interfaces/http/create-http-server.mjs';
import { createKeyRegistry } from '../domain/key-registry.mjs';
import { createFileKeyProvider } from '../infrastructure/keys/file-key-provider.mjs';
import { parseKeyRegistryDocument, readFileKeyRegistry } from '../infrastructure/keys/file-key-registry.mjs';
import { createPostgresStore } from '../infrastructure/persistence/postgres-store.mjs';
import { createRpcClient } from '../infrastructure/blockchain/evm/rpc-client.mjs';
import { getRpcUrls } from '../infrastructure/blockchain/evm/chains.mjs';
import { erc1271CallData } from '../domain/authorization.mjs';
import { PriorSealError } from '../domain/errors.mjs';
import { parsePolicyDocument, readPolicyFile } from '../infrastructure/policy/file-policy-provider.mjs';
import { createObservationWorker } from '../application/observations/observation-worker.mjs';
import { observeExecution } from '../application/observations/observe-execution.mjs';
import { observeEvm } from '../infrastructure/blockchain/evm/observer.mjs';
import { parseTransparencyAnchor, readTransparencyAnchor, verifyTransparencyAnchor } from '../infrastructure/transparency/file-anchor-provider.mjs';
import { buildTransparencyEvidence } from '../domain/transparency.mjs';
import { createHttpWitnessProvider, parseWitnessEndpoints, readWitnessEndpoints } from '../infrastructure/witness/http-witness-client.mjs';
import { createDigiCertTimestampProvider } from '../infrastructure/timestamp/digicert-rfc3161-client.mjs';
import { assertProductionSchema } from './production-schema.mjs';

const { Pool } = pg;

/** Composes the protocol once for Node or Cloudflare without leaking runtime details into the domain. */
export async function createPriorSealRuntime({ config, environment = process.env, database, databaseConnectionString = config.databaseUrl, poolOptions = {}, staticDir, dispatchObservationJob, assertSchema = true } = {}) {
  if (!config) throw new TypeError('Runtime config is required');
  const ownsPool = !database;
  const pool = database ?? (databaseConnectionString ? new Pool({ connectionString: databaseConnectionString, ...poolOptions }) : null);
  try {
    if (assertSchema && config.environment === 'production') await assertProductionSchema(pool, { preExecutionProofMode: config.preExecutionProofMode });
    const store = pool ? createPostgresStore(pool) : undefined;
    const fileKeys = createFileKeyProvider({ privateKeyFile: config.privateKeyFile, publicKeyFile: config.publicKeyFile });
    const privateKeyPem = config.privateKeyPem ?? fileKeys.getPrivateKey();
    const publicKeyPem = config.publicKeyPem ?? fileKeys.getPublicKey();
    const registryEntries = config.keyRegistryJson ? parseKeyRegistryDocument(config.keyRegistryJson) : readFileKeyRegistry(config.keyRegistryFile);
    const registry = createKeyRegistry(registryEntries);
    const policy = config.policyJson ? parsePolicyDocument(config.policyJson) : readPolicyFile(config.policyFile);
    if (config.environment === 'production' && !config.allowSelfAssertedPrincipals && !policy?.principals?.length) throw new TypeError('Production policy must contain at least one reviewed principal or explicitly allow self-asserted principals');
    if (config.preExecutionProofMode === 'witness-quorum' && !policy?.witnessQuorum) throw new TypeError('Witness-quorum mode requires witnessQuorum in the signed authorization policy');
    if (config.preExecutionProofMode === 'rfc3161' && !policy?.timestampPolicy) throw new TypeError('RFC 3161 mode requires timestampPolicy in the signed authorization policy');
    const witnessEndpoints = config.witnessEndpointsJson ? parseWitnessEndpoints(config.witnessEndpointsJson, { requireHttps: config.environment === 'production' }) : readWitnessEndpoints(config.witnessEndpointsFile, { requireHttps: config.environment === 'production' });
    const witnessProvider = config.preExecutionProofMode === 'witness-quorum' ? createHttpWitnessProvider({ policy: policy.witnessQuorum, endpoints: witnessEndpoints, requester: config.issuer }) : null;
    const timestampProvider = config.preExecutionProofMode === 'rfc3161' ? createDigiCertTimestampProvider() : null;
    const rpcClient = createRpcClient();
    const rpcUrls = (chainId) => getRpcUrls(chainId, environment) ?? [];
    const loadTransparencyAnchor = async () => {
      const candidate = config.transparencyAnchorJson ? parseTransparencyAnchor(config.transparencyAnchorJson) : readTransparencyAnchor(config.transparencyAnchorFile);
      return verifyTransparencyAnchor(candidate, { rpcClient, rpcUrls: rpcUrls(candidate?.chainId) });
    };
    if (config.transparencyAnchorFile || config.transparencyAnchorJson) await loadTransparencyAnchor();
    const verifyContractSignature = async ({ authorization, digest, signature }) => {
      for (const url of rpcUrls(authorization.intent.chainId)) {
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
    const observer = (input) => observeEvm({ ...input, rpcUrls: rpcUrls(input.chainId), rpcClient });
    const baseObservationWorker = store ? createObservationWorker({ store, observe: async (input) => (await observeExecution({ input, store, observer, privateKeyPem, publicKeyPem, issuer: config.issuer, keyId: config.keyId, transparencyProvider, authorizationAudience: config.authorizationAudience, verifyContractSignature })).response, saveObservation: (observation) => store.saveObservation(observation) }) : null;
    const observationWorker = baseObservationWorker && dispatchObservationJob ? {
      ...baseObservationWorker,
      async enqueuePersistent(input) {
        const job = await baseObservationWorker.enqueuePersistent(input);
        await dispatchObservationJob(job);
        return job;
      },
    } : baseObservationWorker;
    const server = createHttpServer({ store, issuer: config.issuer, keyId: config.keyId, privateKeyPem, publicKeyPem, keyRegistry: registry, policy, authorizationAudience: config.authorizationAudience, verifyContractSignature, timestampProvider, requireTimestamp: config.preExecutionProofMode === 'rfc3161', witnessProvider, requireWitnessQuorum: config.preExecutionProofMode === 'witness-quorum', transparencyProvider, observationWorker, corsOrigins: config.corsOrigins, trustProxy: config.trustProxy, version: config.buildVersion, staticDir, observer });
    return { config, pool, store, server, observationWorker, baseObservationWorker };
  } catch (error) {
    if (ownsPool) await pool?.end().catch(() => {});
    throw error;
  }
}
