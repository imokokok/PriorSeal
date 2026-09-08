import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../src/bootstrap/runtime-config.mjs';
import { parsePolicyDocument } from '../../src/infrastructure/policy/file-policy-provider.mjs';
import { parseKeyRegistryDocument } from '../../src/infrastructure/keys/file-key-registry.mjs';

const privateKeyPem = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
const publicKeyPem = '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----';
const policy = { policyId: 'public-beta', allowedChainIds: [8453], allowedActions: ['TRANSFER'], minConfirmations: 12, timestampPolicy: { schema: 'priorseal.timestamp-policy.v1', profile: 'digicert-rfc3161-v1', maxClockSkewSeconds: 300 } };

function workerEnvironment(overrides = {}) {
  return {
    PRIORSEAL_RUNTIME: 'cloudflare-workers',
    PRIORSEAL_ENVIRONMENT: 'production',
    PRIORSEAL_ISSUER: 'priorseal.xyz',
    PRIORSEAL_KEY_ID: 'production-1',
    PRIORSEAL_BUILD_VERSION: 'worker-test',
    PRIORSEAL_AUTHORIZATION_AUDIENCE: 'priorseal.xyz',
    PRIORSEAL_PRIVATE_KEY_PEM: privateKeyPem.replaceAll('\n', '\\n'),
    PRIORSEAL_PUBLIC_KEY_PEM: publicKeyPem.replaceAll('\n', '\\n'),
    PRIORSEAL_POLICY_JSON: JSON.stringify(policy),
    PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS: 'true',
    PRIORSEAL_PREEXECUTION_PROOF_MODE: 'rfc3161',
    PRIORSEAL_CORS_ORIGINS: 'https://priorseal.xyz',
    PRIORSEAL_TRUST_PROXY: 'true',
    DATABASE_URL: 'postgresql://worker:secret@example.neon.tech/priorseal?sslmode=require',
    ...overrides,
  };
}

test('Cloudflare production config accepts inline secrets and Hyperdrive without a migration URL', () => {
  const config = loadRuntimeConfig(workerEnvironment());
  assert.equal(config.runtime, 'cloudflare-workers');
  assert.equal(config.databaseDirectUrl, undefined);
  assert.equal(config.privateKeyPem, privateKeyPem);
  assert.equal(config.publicKeyPem, publicKeyPem);
  assert.equal(config.databaseUrl.includes('sslmode=verify-full'), true);
  assert.equal(parsePolicyDocument(config.policyJson).timestampPolicy.profile, 'digicert-rfc3161-v1');
});

test('Cloudflare production config fails closed on partial key and malformed JSON secrets', () => {
  assert.throws(() => loadRuntimeConfig(workerEnvironment({ PRIORSEAL_PUBLIC_KEY_PEM: '' })), /configured together/);
  assert.throws(() => loadRuntimeConfig(workerEnvironment({ PRIORSEAL_POLICY_JSON: '{' })), /must be valid JSON/);
});

test('inline key registry parser rejects private or unknown fields', () => {
  assert.deepEqual(parseKeyRegistryDocument({ schema: 'priorseal.keys.v1', keys: [] }), []);
  assert.throws(() => parseKeyRegistryDocument({ schema: 'priorseal.keys.v1', keys: [{ issuer: 'priorseal.xyz', keyId: 'old', algorithm: 'Ed25519', publicKey: 'pem', privateKey: 'never' }] }), /unsupported field/);
});
