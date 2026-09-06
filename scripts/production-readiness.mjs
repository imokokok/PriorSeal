import { stat } from 'node:fs/promises';
import pg from 'pg';
import { loadRuntimeConfig } from '../src/bootstrap/runtime-config.mjs';
import { readPolicyFile } from '../src/infrastructure/policy/file-policy-provider.mjs';
import { createRpcClient } from '../src/infrastructure/blockchain/evm/rpc-client.mjs';
import { getRpcUrls, SUPPORTED_CHAINS } from '../src/infrastructure/blockchain/evm/chains.mjs';
import { readWitnessEndpoints } from '../src/infrastructure/witness/http-witness-client.mjs';

if (process.env.PRIORSEAL_ENVIRONMENT !== 'production') throw new TypeError('Set PRIORSEAL_ENVIRONMENT=production before running the production readiness check');
const config = loadRuntimeConfig();
const policy = readPolicyFile(config.policyFile);
if (!policy?.principals?.length) throw new TypeError('Production policy must contain at least one reviewed principal');
const witnessEndpoints = config.preExecutionProofMode === 'witness-quorum' ? readWitnessEndpoints(config.witnessEndpointsFile, { requireHttps: true }) : null;
if (config.preExecutionProofMode === 'witness-quorum') {
  if (!policy.witnessQuorum) throw new TypeError('Witness-quorum mode requires a signed witnessQuorum policy');
  const endpointIds = new Set(witnessEndpoints.map((entry) => entry.witnessId));
  if (policy.witnessQuorum.witnesses.some((entry) => !endpointIds.has(entry.witnessId))) throw new TypeError('A signed witness has no configured endpoint');
}
if (config.preExecutionProofMode === 'rfc3161' && !policy.timestampPolicy) throw new TypeError('RFC 3161 mode requires a signed timestampPolicy');
const privateKeyStat = await stat(config.privateKeyFile);
if ((privateKeyStat.mode & 0o077) !== 0) throw new TypeError('Issuer private key must not be readable by group or others');

const pool = new pg.Pool({ connectionString: config.databaseDirectUrl });
try {
  const migrations = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  if (!migrations.rows.some((row) => row.name === '006_rfc3161_timestamp.sql')) throw new TypeError('RFC 3161 timestamp migration is not applied');
  const requiredTables = config.preExecutionProofMode === 'witness-quorum' ? ['authorization_log', 'authorizations', 'witness_attestations'] : ['authorization_log', 'authorizations'];
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)", [requiredTables]);
  if (tables.rowCount !== requiredTables.length) throw new TypeError('Required authorization evidence tables are missing');
  const timestampColumn = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='authorizations' AND column_name='timestamp_evidence_json'");
  if (timestampColumn.rowCount !== 1) throw new TypeError('RFC 3161 timestamp evidence column is missing');
} finally {
  await pool.end();
}

const rpcClient = createRpcClient();
const verifiedChains = [];
for (const chainId of Object.keys(SUPPORTED_CHAINS).map(Number)) {
  const urls = getRpcUrls(chainId) ?? [];
  if (!urls.length) continue;
  const result = await rpcClient.call(urls[0], 'eth_chainId', []);
  if (Number(BigInt(result)) !== chainId) throw new TypeError(`Configured RPC does not match eip155:${chainId}`);
  verifiedChains.push(chainId);
}
if (!verifiedChains.length) throw new TypeError('At least one production RPC must be configured');
console.log(JSON.stringify({ ready: true, databaseMigration: '006_rfc3161_timestamp.sql', reviewedPrincipals: policy.principals.length, verifiedChains, preExecutionProofMode: config.preExecutionProofMode, timestampProfile: policy.timestampPolicy?.profile ?? null, witnessThreshold: policy.witnessQuorum?.threshold ?? null, externalAnchorRequired: config.requireExternalAnchor }));
