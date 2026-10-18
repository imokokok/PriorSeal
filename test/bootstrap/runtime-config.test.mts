import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../src/bootstrap/runtime-config.mjs';

test('runtime configuration normalizes explicit startup dependencies', () => {
  const config = loadRuntimeConfig({
    PORT: '3001',
    PRIORSEAL_ISSUER: 'issuer-1',
    PRIORSEAL_KEY_ID: 'key-1',
    PRIORSEAL_PRIVATE_KEY_FILE: ' /run/secrets/private.pem ',
    PRIORSEAL_PUBLIC_KEY_FILE: ' /run/secrets/public.pem ',
    PRIORSEAL_KEY_REGISTRY_FILE: ' /run/config/keys.json ',
    DATABASE_URL: 'postgresql://app:secret@db.example/priorseal?sslmode=require',
    DATABASE_URL_UNPOOLED: 'postgresql://app:secret@db.example/priorseal?sslmode=require',
    PRIORSEAL_CORS_ORIGINS: 'https://console.example, https://console.example',
    PRIORSEAL_TRUST_PROXY: 'true',
  });

  assert.deepEqual(config, {
    environment: 'development',
    port: 3001,
    issuer: 'issuer-1',
    keyId: 'key-1',
    buildVersion: 'dev',
    authorizationAudience: 'priorseal',
    privateKeyFile: '/run/secrets/private.pem',
    publicKeyFile: '/run/secrets/public.pem',
    keyRegistryFile: '/run/config/keys.json',
    policyFile: undefined,
    transparencyAnchorFile: undefined,
    witnessEndpointsFile: undefined,
    preExecutionProofMode: 'issuer',
    erc4337EntryPoints: [],
    eip7702Delegates: [],
    safe4337Trust: [],
    allowSelfAssertedPrincipals: false,
    requireExternalAnchor: false,
    anchorConfirmations: 12,
    databaseUrl: 'postgresql://app:secret@db.example/priorseal?sslmode=verify-full',
    databaseDirectUrl: 'postgresql://app:secret@db.example/priorseal?sslmode=verify-full',
    databaseBackend: 'postgresql',
    corsOrigins: ['https://console.example'],
    trustProxy: true,
    x402: void 0,
  });
});

test('runtime configuration accepts a Solana-only x402 payment rail', () => {
  const config = loadRuntimeConfig({
    PRIORSEAL_X402_FACILITATOR_URL: 'https://facilitator.example',
    PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://api.example',
    PRIORSEAL_X402_SOLANA_PAY_TO: '11111111111111111111111111111111',
    PRIORSEAL_X402_ROUTES_JSON: '[{"method":"GET","path":"/v1/receipts/:receiptId/bundle","description":"Export a receipt bundle","price":"$0.01"}]',
  });
  assert.equal(config.x402?.payTo, undefined);
  assert.equal(config.x402?.solanaPayTo, '11111111111111111111111111111111');
  assert.throws(() => loadRuntimeConfig({
    PRIORSEAL_X402_FACILITATOR_URL: 'https://facilitator.example', PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://api.example', PRIORSEAL_X402_SOLANA_PAY_TO: '11111111111111111111111111111111',
    PRIORSEAL_X402_NETWORKS: 'eip155:8453', PRIORSEAL_X402_ROUTES_JSON: '[{"method":"GET","path":"/v1/receipts/:receiptId/bundle","description":"Export a receipt bundle","price":"$0.01"}]',
  }), /EVM payment rail/);
  assert.throws(() => loadRuntimeConfig({
    PRIORSEAL_X402_FACILITATOR_URL: 'https://facilitator.example', PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://api.example', PRIORSEAL_X402_PAY_TO: `0x${'b'.repeat(40)}`,
    PRIORSEAL_X402_NETWORKS: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', PRIORSEAL_X402_ROUTES_JSON: '[{"method":"GET","path":"/v1/receipts/:receiptId/bundle","description":"Export a receipt bundle","price":"$0.01"}]',
  }), /selects Solana/);
});

test('runtime configuration enables guarded Jupiter only with a complete server-side configuration', () => {
  const policy = JSON.stringify({
    maxInputAmountAtomic: '1000000', maxSlippageBps: 50,
    allowedProgramIds: ['ComputeBudget111111111111111111111111111111'], authorizationTtlSeconds: 60,
  });
  const config = loadRuntimeConfig({
    JUPITER_API_KEY: 'jupiter-secret', INSIGHT_API_KEY: 'insight-secret',
    PRIORSEAL_JUPITER_RPC_URL: 'https://rpc.example', PRIORSEAL_JUPITER_POLICY_JSON: policy,
  });
  assert.deepEqual(config.guardedJupiter, {
    jupiterApiKey: 'jupiter-secret', insightApiKey: 'insight-secret', rpcUrl: 'https://rpc.example',
    policy: JSON.parse(policy),
  });
  assert.throws(() => loadRuntimeConfig({ JUPITER_API_KEY: 'jupiter-secret' }), /require JUPITER_API_KEY/);
  assert.throws(() => loadRuntimeConfig({ JUPITER_API_KEY: 'jupiter-secret', INSIGHT_API_KEY: 'insight-secret', PRIORSEAL_JUPITER_RPC_URL: 'http://rpc.example', PRIORSEAL_JUPITER_POLICY_JSON: policy }), /must use HTTPS/);
  assert.throws(() => loadRuntimeConfig({ JUPITER_API_KEY: 'jupiter-secret', INSIGHT_API_KEY: 'insight-secret', PRIORSEAL_JUPITER_RPC_URL: 'https://rpc.example', PRIORSEAL_JUPITER_POLICY_JSON: '[]' }), /must be an object/);
});

test('Base Sepolia x402 is an explicit staging-only payment rail', () => {
  const x402 = {
    PRIORSEAL_X402_FACILITATOR_URL: 'https://facilitator.example', PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://api.example', PRIORSEAL_X402_PAY_TO: `0x${'b'.repeat(40)}`,
    PRIORSEAL_X402_NETWORKS: 'eip155:84532', PRIORSEAL_X402_ROUTES_JSON: '[{"method":"GET","path":"/v1/receipts/:receiptId/bundle","description":"Export a receipt bundle","price":"$0.01"}]',
  };
  assert.throws(() => loadRuntimeConfig({ ...x402, PRIORSEAL_ENVIRONMENT: 'test' }), /unsupported payment network/);
  const staging = loadRuntimeConfig({ ...x402, PRIORSEAL_ENVIRONMENT: 'test', PRIORSEAL_X402_ENABLE_TESTNETS: 'true' });
  assert.deepEqual(staging.x402?.networks, ['eip155:84532']);
  assert.equal(staging.x402?.testnetNetworksEnabled, true);
  assert.throws(() => loadRuntimeConfig({ ...x402, PRIORSEAL_ENVIRONMENT: 'production', PRIORSEAL_X402_ENABLE_TESTNETS: 'true' }), /allowed only/);
});

test('runtime configuration rejects ambiguous or invalid values before startup', () => {
  assert.throws(() => loadRuntimeConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_PRIVATE_KEY_FILE: '/private.pem' }), /configured together/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_CORS_ORIGINS: 'https://console.example/path' }), /without paths/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_TRUST_PROXY: 'yes' }), /true or false/);
  assert.throws(() => loadRuntimeConfig({ DATABASE_URL: 'https://db.example' }), /PostgreSQL/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_ENVIRONMENT: 'live' }), /development, test, or production/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_DATABASE_BACKEND: 'mysql' }), /DATABASE_BACKEND/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_POLICY_FILE: '/policy.json', PRIORSEAL_POLICY_JSON: '{}' }), /file or inline JSON/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_KEY_REGISTRY_FILE: '/keys.json', PRIORSEAL_KEY_REGISTRY_JSON: '{"schema":"priorseal.keys.v1","keys":[]}' }), /file or inline JSON/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_ENVIRONMENT: 'production' }), /Production requires/);
  const entryPoint = '[{"chainId":8453,"version":"0.7","address":"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","codeHash":"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}]';
  const safeTrust = '[{"chainId":8453,"version":"0.7","entryPointAddress":"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","moduleAddress":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","moduleCodeHash":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","safeProxyCodeHash":"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","safeSingletonCodeHash":"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]';
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_SAFE_4337_TRUST_JSON: safeTrust }), /requires a matching configured EntryPoint/);
  assert.deepEqual(loadRuntimeConfig({ PRIORSEAL_ERC4337_ENTRY_POINTS_JSON: entryPoint, PRIORSEAL_SAFE_4337_TRUST_JSON: safeTrust }).safe4337Trust, [{ chainId: 8453, version: '0.7', entryPointAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', moduleAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', moduleCodeHash: `0x${'b'.repeat(64)}`, safeProxyCodeHash: `0x${'d'.repeat(64)}`, safeSingletonCodeHash: `0x${'c'.repeat(64)}` }]);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_ERC4337_ENTRY_POINTS_JSON: entryPoint, PRIORSEAL_SAFE_4337_TRUST_JSON: safeTrust.replace('moduleCodeHash', 'unknown') }), /invalid shape/);
  const delegateTrust = '[{"chainId":8453,"address":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","codeHash":"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}]';
  assert.deepEqual(loadRuntimeConfig({ PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON: delegateTrust }).eip7702Delegates, [{ chainId: 8453, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', codeHash: `0x${'d'.repeat(64)}` }]);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON: delegateTrust.replace('"address"', '"delegate"') }), /invalid shape/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON: delegateTrust.replace('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0x0000000000000000000000000000000000000000') }), /invalid address/);
});

test('production runtime fails closed unless security dependencies are explicit', () => {
  const base = {
    PRIORSEAL_ENVIRONMENT: 'production', PRIORSEAL_ISSUER: 'priorseal-prod', PRIORSEAL_KEY_ID: 'prod-1', PRIORSEAL_BUILD_VERSION: '0.2.0',
    PRIORSEAL_AUTHORIZATION_AUDIENCE: 'priorseal.example.com', PRIORSEAL_PRIVATE_KEY_FILE: '/private.pem', PRIORSEAL_PUBLIC_KEY_FILE: '/public.pem',
    PRIORSEAL_POLICY_FILE: '/policy.json', PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR: 'true', PRIORSEAL_TRANSPARENCY_ANCHOR_FILE: '/anchor.json', PRIORSEAL_CORS_ORIGINS: 'https://priorseal.example.com',
    DATABASE_URL: 'postgresql://app:secret@db.example/priorseal?sslmode=verify-full', DATABASE_URL_UNPOOLED: 'postgresql://app:secret@db.example/priorseal?sslmode=verify-full',
  };
  assert.equal(loadRuntimeConfig(base).environment, 'production');
  const x402 = {
    PRIORSEAL_X402_FACILITATOR_URL: 'https://facilitator.example', PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://api.example', PRIORSEAL_X402_PAY_TO: `0x${'b'.repeat(40)}`,
    PRIORSEAL_X402_ROUTES_JSON: '[{"method":"GET","path":"/v1/receipts/:receiptId/bundle","description":"Export a receipt bundle","price":"$0.01"}]',
  };
  assert.throws(() => loadRuntimeConfig({ ...base, ...x402 }), /X402_NETWORKS allowlist/);
  assert.deepEqual(loadRuntimeConfig({ ...base, ...x402, PRIORSEAL_X402_NETWORKS: 'eip155:8453' }).x402?.networks, ['eip155:8453']);
  const { DATABASE_URL: _pooled, DATABASE_URL_UNPOOLED: _direct, ...d1Base } = base;
  assert.equal(loadRuntimeConfig({ ...d1Base, PRIORSEAL_RUNTIME: 'cloudflare-workers', PRIORSEAL_DATABASE_BACKEND: 'd1' }).databaseBackend, 'd1');
  const { PRIORSEAL_TRANSPARENCY_ANCHOR_FILE: _anchor, ...withoutAnchor } = base;
  assert.throws(() => loadRuntimeConfig(withoutAnchor), /requires a transparency anchor/);
  assert.equal(loadRuntimeConfig({ ...base, PRIORSEAL_ANCHOR_CONFIRMATIONS: '24' }).anchorConfirmations, 24);
  assert.throws(() => loadRuntimeConfig({ ...base, PRIORSEAL_ANCHOR_CONFIRMATIONS: '0' }), /ANCHOR_CONFIRMATIONS/);
  assert.throws(() => loadRuntimeConfig({ ...base, PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR: 'false' }), /PREEXECUTION_PROOF_MODE/);
  const witnessed = loadRuntimeConfig({ ...base, PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR: 'false', PRIORSEAL_PREEXECUTION_PROOF_MODE: 'witness-quorum', PRIORSEAL_WITNESS_ENDPOINTS_FILE: '/witnesses.json' });
  assert.equal(witnessed.requireExternalAnchor, false);
  assert.equal(witnessed.preExecutionProofMode, 'witness-quorum');
  const timestamped = loadRuntimeConfig({ ...base, PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR: 'false', PRIORSEAL_PREEXECUTION_PROOF_MODE: 'rfc3161' });
  assert.equal(timestamped.preExecutionProofMode, 'rfc3161');
  assert.equal(timestamped.allowSelfAssertedPrincipals, false);
  assert.equal(loadRuntimeConfig({ ...base, PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR: 'false', PRIORSEAL_PREEXECUTION_PROOF_MODE: 'rfc3161', PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS: 'true' }).allowSelfAssertedPrincipals, true);
  assert.throws(() => loadRuntimeConfig({ ...base, PRIORSEAL_CORS_ORIGINS: 'http://localhost:5173' }), /non-localhost/);
  assert.throws(() => loadRuntimeConfig({ ...base, PRIORSEAL_KEY_ID: 'default' }), /deployment-specific PRIORSEAL_KEY_ID/);
  assert.throws(() => loadRuntimeConfig({ ...base, PRIORSEAL_BUILD_VERSION: 'dev' }), /PRIORSEAL_BUILD_VERSION/);
});
