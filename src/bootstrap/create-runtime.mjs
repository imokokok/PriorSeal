// Generated from create-runtime.mts by npm run core:build. Do not edit directly.
import pg from "pg";
import { createHttpServer } from "../interfaces/http/create-http-server.mjs";
import { createKeyRegistry } from "../domain/key-registry.mjs";
import { createFileKeyProvider } from "../infrastructure/keys/file-key-provider.mjs";
import { parseKeyRegistryDocument, readFileKeyRegistry } from "../infrastructure/keys/file-key-registry.mjs";
import { createPostgresStore } from "../infrastructure/persistence/postgres-store.mjs";
import { createD1Store } from "../infrastructure/persistence/d1-store.mjs";
import { createRpcClient } from "../infrastructure/blockchain/evm/rpc-client.mjs";
import { getRpcUrls, SUPPORTED_CHAINS } from "../infrastructure/blockchain/evm/chains.mjs";
import { PriorSealError } from "../domain/errors.mjs";
import { parsePolicyDocument, readPolicyFile } from "../infrastructure/policy/file-policy-provider.mjs";
import { createObservationWorker } from "../application/observations/observation-worker.mjs";
import { observeExecution } from "../application/observations/observe-execution.mjs";
import { observeEvm } from "../infrastructure/blockchain/evm/observer.mjs";
import { parseTransparencyAnchor, readTransparencyAnchor, verifyTransparencyAnchor } from "../infrastructure/transparency/file-anchor-provider.mjs";
import { buildMerkleTransparencyEvidence, buildTransparencyEvidence } from "../domain/transparency.mjs";
import { createHttpWitnessProvider, parseWitnessEndpoints, readWitnessEndpoints } from "../infrastructure/witness/http-witness-client.mjs";
import { createDigiCertTimestampProvider } from "../infrastructure/timestamp/digicert-rfc3161-client.mjs";
import { assertProductionSchema } from "./production-schema.mjs";
import { createContractSignatureVerifier } from "../infrastructure/blockchain/evm/contract-signature-verifier.mjs";
import { assertEd25519KeyPair } from "../domain/ed25519.mjs";
const { Pool } = pg;
async function createPriorSealRuntime({ config, environment = process.env, database, d1, databaseConnectionString = config?.databaseUrl, poolOptions = {}, staticDir, dispatchObservationJob, rateLimiter, assertSchema = true } = {}) {
  if (!config) throw new TypeError("Runtime config is required");
  const ownsPool = !database;
  const pool = d1 ? null : database ?? (databaseConnectionString ? new Pool({ connectionString: databaseConnectionString, ...poolOptions }) : null);
  try {
    if (assertSchema && config.environment === "production" && !d1) await assertProductionSchema(pool, { preExecutionProofMode: config.preExecutionProofMode, archiveEnabled: Boolean(config.archiveCredentials) });
    const store = d1 ? createD1Store(d1) : pool ? createPostgresStore(pool) : void 0;
    const fileKeys = createFileKeyProvider({ privateKeyFile: config.privateKeyFile, publicKeyFile: config.publicKeyFile });
    const privateKeyPem = config.privateKeyPem ?? fileKeys.getPrivateKey();
    const publicKeyPem = config.publicKeyPem ?? fileKeys.getPublicKey();
    if (privateKeyPem || publicKeyPem) {
      if (!privateKeyPem || !publicKeyPem) throw new TypeError("Issuer private and public keys must be configured together");
      assertEd25519KeyPair(privateKeyPem, publicKeyPem);
    }
    const registryEntries = config.keyRegistryJson ? parseKeyRegistryDocument(config.keyRegistryJson) : readFileKeyRegistry(config.keyRegistryFile);
    const registry = createKeyRegistry(registryEntries);
    const policy = config.policyJson ? parsePolicyDocument(config.policyJson) : readPolicyFile(config.policyFile);
    if (config.environment === "production" && !config.allowSelfAssertedPrincipals && !policy?.principals?.length) throw new TypeError("Production policy must contain at least one reviewed principal or explicitly allow self-asserted principals");
    if (config.preExecutionProofMode === "witness-quorum" && !policy?.witnessQuorum) throw new TypeError("Witness-quorum mode requires witnessQuorum in the signed authorization policy");
    if (config.preExecutionProofMode === "rfc3161" && !policy?.timestampPolicy) throw new TypeError("RFC 3161 mode requires timestampPolicy in the signed authorization policy");
    const witnessEndpoints = config.witnessEndpointsJson ? parseWitnessEndpoints(config.witnessEndpointsJson, { requireHttps: config.environment === "production" }) : readWitnessEndpoints(config.witnessEndpointsFile, { requireHttps: config.environment === "production" });
    const witnessProvider = config.preExecutionProofMode === "witness-quorum" ? createHttpWitnessProvider({ policy: policy?.witnessQuorum, endpoints: witnessEndpoints, requester: config.issuer }) : null;
    const timestampProvider = config.preExecutionProofMode === "rfc3161" ? createDigiCertTimestampProvider() : null;
    const rpcClient = createRpcClient();
    const rpcUrls = (chainId) => getRpcUrls(chainId ?? -1, environment) ?? [];
    const loadTransparencyAnchor = async () => {
      const candidate = config.transparencyAnchorJson ? parseTransparencyAnchor(config.transparencyAnchorJson) : readTransparencyAnchor(config.transparencyAnchorFile);
      return verifyTransparencyAnchor(candidate, { rpcClient, rpcUrls: rpcUrls(candidate?.chainId), minConfirmations: config.anchorConfirmations });
    };
    if (config.transparencyAnchorFile || config.transparencyAnchorJson) await loadTransparencyAnchor();
    const verifyContractSignature = createContractSignatureVerifier({ rpcClient, rpcUrls });
    if (publicKeyPem) registry.add({ issuer: config.issuer, keyId: config.keyId, algorithm: "Ed25519", publicKey: publicKeyPem, status: "active", validFrom: null, validUntil: null });
    const transparencyProvider = store && privateKeyPem ? async (acceptance, { before } = {}) => {
      const anchor = await loadTransparencyAnchor();
      const coveringAnchor = anchor && anchor.size >= acceptance.sequence ? anchor : null;
      const parameters = { acceptance, issuer: config.issuer, keyId: config.keyId, privateKeyPem, issuedAt: Math.floor(Date.now() / 1e3), anchor: coveringAnchor, before };
      const evidence = coveringAnchor && !coveringAnchor.merkleRoot ? buildTransparencyEvidence({ ...parameters, entries: await store.listAuthorizationLog() }) : buildMerkleTransparencyEvidence({ ...parameters, snapshot: await store.getAuthorizationMerkleSnapshot(acceptance, coveringAnchor?.size ?? null) });
      if (config.requireExternalAnchor && !evidence.checkpoint.anchor) throw new PriorSealError("TRANSPARENCY_ANCHOR_REQUIRED", "A verified external anchor covering this authorization is required before execution");
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
      }
    } : baseObservationWorker;
    const server = createHttpServer({ archiveCredentials: config.archiveCredentials, proofMode: config.preExecutionProofMode, rpcChainIds: Object.keys(SUPPORTED_CHAINS).map(Number).filter((id) => rpcUrls(id).length > 0), store, issuer: config.issuer, keyId: config.keyId, privateKeyPem, publicKeyPem, keyRegistry: registry, policy, authorizationAudience: config.authorizationAudience, verifyContractSignature, timestampProvider, requireTimestamp: config.preExecutionProofMode === "rfc3161", witnessProvider, requireWitnessQuorum: config.preExecutionProofMode === "witness-quorum", transparencyProvider, observationWorker, corsOrigins: config.corsOrigins, trustProxy: config.trustProxy, version: config.buildVersion, staticDir, observer, rateLimiter });
    return { config, pool, store, server, observationWorker, baseObservationWorker };
  } catch (error) {
    if (ownsPool) await pool?.end().catch(() => {
    });
    throw error;
  }
}
export {
  createPriorSealRuntime
};
