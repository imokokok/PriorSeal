import { stat } from 'node:fs/promises';
import pg from 'pg';
import { loadRuntimeConfig } from '../src/bootstrap/runtime-config.mjs';
import { parsePolicyDocument, readPolicyFile } from '../src/infrastructure/policy/file-policy-provider.mjs';
import { createRpcClient } from '../src/infrastructure/blockchain/evm/rpc-client.mjs';
import { getRpcUrls, SUPPORTED_CHAINS } from '../src/infrastructure/blockchain/evm/chains.mjs';
import { parseWitnessEndpoints, readWitnessEndpoints } from '../src/infrastructure/witness/http-witness-client.mjs';
import { assertProductionSchema, REQUIRED_PRODUCTION_MIGRATION } from '../src/bootstrap/production-schema.mjs';
import { parseTransparencyAnchor, readTransparencyAnchor, verifyTransparencyAnchor } from '../src/infrastructure/transparency/file-anchor-provider.mjs';

if (process.env.PRIORSEAL_ENVIRONMENT !== 'production') throw new TypeError('Set PRIORSEAL_ENVIRONMENT=production before running the production readiness check');
const config = loadRuntimeConfig();
const policy = config.policyJson ? parsePolicyDocument(config.policyJson) : readPolicyFile(config.policyFile);
if (!policy) throw new TypeError('Production policy must be configured');
if (!config.allowSelfAssertedPrincipals && !policy?.principals?.length) throw new TypeError('Production policy must contain at least one reviewed principal or explicitly allow self-asserted principals');
const witnessEndpoints = config.preExecutionProofMode === 'witness-quorum' ? config.witnessEndpointsJson ? parseWitnessEndpoints(config.witnessEndpointsJson, { requireHttps: true }) : readWitnessEndpoints(config.witnessEndpointsFile, { requireHttps: true }) : null;
if (config.preExecutionProofMode === 'witness-quorum') {
  if (!witnessEndpoints) throw new TypeError('Witness-quorum mode requires configured witness endpoints');
  if (!policy.witnessQuorum) throw new TypeError('Witness-quorum mode requires a signed witnessQuorum policy');
  const endpointIds = new Set(witnessEndpoints.map((entry) => entry.witnessId));
  if (policy.witnessQuorum.witnesses.some((entry) => !endpointIds.has(entry.witnessId))) throw new TypeError('A signed witness has no configured endpoint');
}
if (config.preExecutionProofMode === 'rfc3161' && !policy.timestampPolicy) throw new TypeError('RFC 3161 mode requires a signed timestampPolicy');
if (config.privateKeyFile) {
  const privateKeyStat = await stat(config.privateKeyFile);
  if ((privateKeyStat.mode & 0o077) !== 0) throw new TypeError('Issuer private key must not be readable by group or others');
}

const pool = new pg.Pool({ connectionString: config.databaseDirectUrl });
try {
  await assertProductionSchema(pool, { preExecutionProofMode: config.preExecutionProofMode, archiveEnabled: Boolean(config.archiveCredentials) });
} finally {
  await pool.end();
}

const rpcClient = createRpcClient();
const verifiedChains = [];
for (const chainId of Object.keys(SUPPORTED_CHAINS).map(Number)) {
  const urls = getRpcUrls(chainId) ?? [];
  if (!urls.length) continue;
  for (const url of urls) {
    const result = await rpcClient.call<string>(url, 'eth_chainId', []);
    if (Number(BigInt(result)) !== chainId) throw new TypeError(`Configured RPC does not match eip155:${chainId}`);
  }
  verifiedChains.push(chainId);
}
if (!verifiedChains.length) throw new TypeError('At least one production RPC must be configured');
let verifiedAnchor = null;
if (config.preExecutionProofMode === 'evm-anchor') {
  const candidate = config.transparencyAnchorJson ? parseTransparencyAnchor(config.transparencyAnchorJson) : readTransparencyAnchor(config.transparencyAnchorFile);
  if (!candidate) throw new TypeError('EVM-anchor mode requires a transparency anchor');
  verifiedAnchor = await verifyTransparencyAnchor(candidate, { rpcClient, rpcUrls: getRpcUrls(candidate.chainId) ?? [], minConfirmations: config.anchorConfirmations });
}
console.log(JSON.stringify({ ready: true, buildVersion: config.buildVersion, databaseMigration: REQUIRED_PRODUCTION_MIGRATION, principalMode: config.allowSelfAssertedPrincipals ? 'self-asserted' : 'reviewed-registry', reviewedPrincipals: policy.principals?.length ?? 0, verifiedChains, preExecutionProofMode: config.preExecutionProofMode, timestampProfile: policy.timestampPolicy?.profile ?? null, witnessThreshold: policy.witnessQuorum?.threshold ?? null, externalAnchorRequired: config.requireExternalAnchor, anchorConfirmations: config.anchorConfirmations, verifiedAnchorTxHash: verifiedAnchor?.txHash ?? null }));
