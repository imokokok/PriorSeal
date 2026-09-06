import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../src/bootstrap/runtime-config.mjs';

test('runtime configuration normalizes explicit startup dependencies', () => {
  const config = loadRuntimeConfig({
    PORT: '3001',
    RUNPROOF_ISSUER: 'issuer-1',
    RUNPROOF_KEY_ID: 'key-1',
    RUNPROOF_PRIVATE_KEY_FILE: ' /run/secrets/private.pem ',
    RUNPROOF_PUBLIC_KEY_FILE: ' /run/secrets/public.pem ',
    RUNPROOF_KEY_REGISTRY_FILE: ' /run/config/keys.json ',
    DATABASE_URL: 'postgresql://app:secret@db.example/runproof?sslmode=require',
    DATABASE_URL_UNPOOLED: 'postgresql://app:secret@db.example/runproof?sslmode=require',
    RUNPROOF_CORS_ORIGINS: 'https://console.example, https://console.example',
    RUNPROOF_TRUST_PROXY: 'true',
  });

  assert.deepEqual(config, {
    environment: 'development',
    port: 3001,
    issuer: 'issuer-1',
    keyId: 'key-1',
    authorizationAudience: 'runproof',
    privateKeyFile: '/run/secrets/private.pem',
    publicKeyFile: '/run/secrets/public.pem',
    keyRegistryFile: '/run/config/keys.json',
    policyFile: undefined,
    transparencyAnchorFile: undefined,
    witnessEndpointsFile: undefined,
    preExecutionProofMode: 'issuer',
    requireExternalAnchor: false,
    databaseUrl: 'postgresql://app:secret@db.example/runproof?sslmode=verify-full',
    databaseDirectUrl: 'postgresql://app:secret@db.example/runproof?sslmode=verify-full',
    corsOrigins: ['https://console.example'],
    trustProxy: true,
  });
});

test('runtime configuration rejects ambiguous or invalid values before startup', () => {
  assert.throws(() => loadRuntimeConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => loadRuntimeConfig({ RUNPROOF_PRIVATE_KEY_FILE: '/private.pem' }), /configured together/);
  assert.throws(() => loadRuntimeConfig({ RUNPROOF_CORS_ORIGINS: 'https://console.example/path' }), /without paths/);
  assert.throws(() => loadRuntimeConfig({ RUNPROOF_TRUST_PROXY: 'yes' }), /true or false/);
  assert.throws(() => loadRuntimeConfig({ DATABASE_URL: 'https://db.example' }), /PostgreSQL/);
  assert.throws(() => loadRuntimeConfig({ RUNPROOF_ENVIRONMENT: 'live' }), /development, test, or production/);
  assert.throws(() => loadRuntimeConfig({ RUNPROOF_ENVIRONMENT: 'production' }), /Production requires/);
});

test('production runtime fails closed unless security dependencies are explicit', () => {
  const base = {
    RUNPROOF_ENVIRONMENT: 'production', RUNPROOF_ISSUER: 'runproof-prod', RUNPROOF_KEY_ID: 'prod-1',
    RUNPROOF_AUTHORIZATION_AUDIENCE: 'runproof.example.com', RUNPROOF_PRIVATE_KEY_FILE: '/private.pem', RUNPROOF_PUBLIC_KEY_FILE: '/public.pem',
    RUNPROOF_POLICY_FILE: '/policy.json', RUNPROOF_REQUIRE_EXTERNAL_ANCHOR: 'true', RUNPROOF_CORS_ORIGINS: 'https://runproof.example.com',
    DATABASE_URL: 'postgresql://app:secret@db.example/runproof?sslmode=verify-full', DATABASE_URL_UNPOOLED: 'postgresql://app:secret@db.example/runproof?sslmode=verify-full',
  };
  assert.equal(loadRuntimeConfig(base).environment, 'production');
  assert.throws(() => loadRuntimeConfig({ ...base, RUNPROOF_REQUIRE_EXTERNAL_ANCHOR: 'false' }), /PREEXECUTION_PROOF_MODE/);
  const witnessed = loadRuntimeConfig({ ...base, RUNPROOF_REQUIRE_EXTERNAL_ANCHOR: 'false', RUNPROOF_PREEXECUTION_PROOF_MODE: 'witness-quorum', RUNPROOF_WITNESS_ENDPOINTS_FILE: '/witnesses.json' });
  assert.equal(witnessed.requireExternalAnchor, false);
  assert.equal(witnessed.preExecutionProofMode, 'witness-quorum');
  const timestamped = loadRuntimeConfig({ ...base, RUNPROOF_REQUIRE_EXTERNAL_ANCHOR: 'false', RUNPROOF_PREEXECUTION_PROOF_MODE: 'rfc3161' });
  assert.equal(timestamped.preExecutionProofMode, 'rfc3161');
  assert.throws(() => loadRuntimeConfig({ ...base, RUNPROOF_CORS_ORIGINS: 'http://localhost:5173' }), /non-localhost/);
});
