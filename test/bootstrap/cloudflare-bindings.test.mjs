import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCloudflareBindings, cloudflareRuntimeEnvironment, createCloudflareRateLimiter } from '../../src/bootstrap/cloudflare-bindings.mjs';

function bindings(overrides = {}) {
  return {
    HYPERDRIVE: { connectionString: 'postgresql://example.test/priorseal' },
    OBSERVATION_QUEUE: { async send() {} },
    HTTP_RATE_LIMITER: { async limit() { return { success: true }; } },
    CF_VERSION_METADATA: { id: 'version-id', tag: '0123456789abcdef0123456789abcdef01234567' },
    ...overrides,
  };
}

test('Cloudflare runtime requires production bindings and uses the Git version tag', () => {
  const environment = bindings();
  assert.doesNotThrow(() => assertCloudflareBindings(environment));
  assert.equal(cloudflareRuntimeEnvironment(environment).PRIORSEAL_BUILD_VERSION, environment.CF_VERSION_METADATA.tag);
  assert.equal(cloudflareRuntimeEnvironment(bindings({ CF_VERSION_METADATA: { id: 'version-only' } })).PRIORSEAL_BUILD_VERSION, 'version-only');
  assert.throws(() => assertCloudflareBindings(bindings({ HTTP_RATE_LIMITER: undefined })), /HTTP_RATE_LIMITER/);
  assert.throws(() => assertCloudflareBindings(bindings({ CF_VERSION_METADATA: undefined })), /CF_VERSION_METADATA/);
});

test('Cloudflare rate limiter awaits the shared binding and fails closed', async () => {
  const keys = [];
  const limiter = createCloudflareRateLimiter({ async limit(input) { keys.push(input.key); return { success: keys.length === 1 }; } });
  assert.equal(await limiter.allow('principal-1'), true);
  assert.equal(await limiter.allow('principal-1'), false);
  assert.deepEqual(keys, ['principal-1', 'principal-1']);
  await assert.rejects(() => createCloudflareRateLimiter({ async limit() { throw new Error('binding failed'); } }).allow('principal-1'), (error) => error.code === 'RATE_LIMITER_UNAVAILABLE');
});
