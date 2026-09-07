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
    requireExternalAnchor: false,
    databaseUrl: 'postgresql://app:secret@db.example/priorseal?sslmode=verify-full',
    databaseDirectUrl: 'postgresql://app:secret@db.example/priorseal?sslmode=verify-full',
    corsOrigins: ['https://console.example'],
    trustProxy: true,
  });
});

test('runtime configuration rejects ambiguous or invalid values before startup', () => {
  assert.throws(() => loadRuntimeConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_PRIVATE_KEY_FILE: '/private.pem' }), /configured together/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_CORS_ORIGINS: 'https://console.example/path' }), /without paths/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_TRUST_PROXY: 'yes' }), /true or false/);
  assert.throws(() => loadRuntimeConfig({ DATABASE_URL: 'https://db.example' }), /PostgreSQL/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_ENVIRONMENT: 'live' }), /development, test, or production/);
  assert.throws(() => loadRuntimeConfig({ PRIORSEAL_ENVIRONMENT: 'production' }), /Production requires/);
});

test('production runtime fails closed unless security dependencies are explicit', () => {
  const base = {
    PRIORSEAL_ENVIRONMENT: 'production', PRIORSEAL_ISSUER: 'priorseal-prod', PRIORSEAL_KEY_ID: 'prod-1', PRIORSEAL_BUILD_VERSION: '0.2.0',
    PRIORSEAL_AUTHORIZATION_AUDIENCE: 'priorseal.example.com', PRIORSEAL_PRIVATE_KEY_FILE: '/private.pem', PRIORSEAL_PUBLIC_KEY_FILE: '/public.pem',
    PRIORSEAL_POLICY_FILE: '/policy.json', PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR: 'true', PRIORSEAL_CORS_ORIGINS: 'https://priorseal.example.com',
    DATABASE_URL: 'postgresql://app:secret@db.example/priorseal?sslmode=verify-full', DATABASE_URL_UNPOOLED: 'postgresql://app:secret@db.example/priorseal?sslmode=verify-full',
  };
  assert.equal(loadRuntimeConfig(base).environment, 'production');
  assert.throws(() => loadRuntimeConfig({ ...base, PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR: 'false' }), /PREEXECUTION_PROOF_MODE/);
  const witnessed = loadRuntimeConfig({ ...base, PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR: 'false', PRIORSEAL_PREEXECUTION_PROOF_MODE: 'witness-quorum', PRIORSEAL_WITNESS_ENDPOINTS_FILE: '/witnesses.json' });
  assert.equal(witnessed.requireExternalAnchor, false);
  assert.equal(witnessed.preExecutionProofMode, 'witness-quorum');
  const timestamped = loadRuntimeConfig({ ...base, PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR: 'false', PRIORSEAL_PREEXECUTION_PROOF_MODE: 'rfc3161' });
  assert.equal(timestamped.preExecutionProofMode, 'rfc3161');
  assert.throws(() => loadRuntimeConfig({ ...base, PRIORSEAL_CORS_ORIGINS: 'http://localhost:5173' }), /non-localhost/);
  assert.throws(() => loadRuntimeConfig({ ...base, PRIORSEAL_KEY_ID: 'default' }), /deployment-specific PRIORSEAL_KEY_ID/);
  assert.throws(() => loadRuntimeConfig({ ...base, PRIORSEAL_BUILD_VERSION: 'dev' }), /PRIORSEAL_BUILD_VERSION/);
});
