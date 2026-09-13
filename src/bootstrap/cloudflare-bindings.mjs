import { PriorSealError } from '../domain/errors.mjs';

export function assertCloudflareBindings(environment) {
  if (!environment.HYPERDRIVE?.connectionString) throw new TypeError('HYPERDRIVE binding is required');
  if (!environment.OBSERVATION_QUEUE?.send) throw new TypeError('OBSERVATION_QUEUE binding is required');
  if (!environment.HTTP_RATE_LIMITER?.limit) throw new TypeError('HTTP_RATE_LIMITER binding is required');
  if (!environment.CF_VERSION_METADATA?.id) throw new TypeError('CF_VERSION_METADATA binding is required');
}

export function cloudflareRuntimeEnvironment(environment) {
  assertCloudflareBindings(environment);
  return {
    ...environment,
    PRIORSEAL_RUNTIME: 'cloudflare-workers',
    DATABASE_URL: environment.HYPERDRIVE.connectionString,
    PRIORSEAL_BUILD_VERSION: environment.CF_VERSION_METADATA.tag || environment.CF_VERSION_METADATA.id,
  };
}

export function createCloudflareRateLimiter(binding) {
  if (!binding?.limit) throw new TypeError('A Cloudflare Rate Limiting binding is required');
  return {
    async allow(key) {
      try {
        const result = await binding.limit({ key });
        return result?.success === true;
      } catch {
        throw new PriorSealError('RATE_LIMITER_UNAVAILABLE', 'Rate limiting is temporarily unavailable');
      }
    },
  };
}
