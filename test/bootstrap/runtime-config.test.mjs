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
    RUNPROOF_CORS_ORIGINS: 'https://console.example, https://console.example',
    RUNPROOF_TRUST_PROXY: 'true',
  });

  assert.deepEqual(config, {
    port: 3001,
    issuer: 'issuer-1',
    keyId: 'key-1',
    privateKeyFile: '/run/secrets/private.pem',
    publicKeyFile: '/run/secrets/public.pem',
    corsOrigins: ['https://console.example'],
    trustProxy: true,
  });
});

test('runtime configuration rejects ambiguous or invalid values before startup', () => {
  assert.throws(() => loadRuntimeConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => loadRuntimeConfig({ RUNPROOF_PRIVATE_KEY_FILE: '/private.pem' }), /configured together/);
  assert.throws(() => loadRuntimeConfig({ RUNPROOF_CORS_ORIGINS: 'https://console.example/path' }), /without paths/);
  assert.throws(() => loadRuntimeConfig({ RUNPROOF_TRUST_PROXY: 'yes' }), /true or false/);
});
