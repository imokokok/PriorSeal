import { PriorSealError } from '../domain/errors.mjs';

export function assertCloudflareBindings(environment: Env) {
  if (!environment.DB?.prepare) throw new TypeError('DB D1 binding is required');
  if (!environment.OBSERVATION_QUEUE?.send) throw new TypeError('OBSERVATION_QUEUE binding is required');
  if (!environment.HTTP_RATE_LIMITER?.limit) throw new TypeError('HTTP_RATE_LIMITER binding is required');
  if (!environment.CF_VERSION_METADATA?.id) throw new TypeError('CF_VERSION_METADATA binding is required');
}

export function cloudflareRuntimeEnvironment(environment: Env) {
  assertCloudflareBindings(environment);
  const configuredVersion = environment.PRIORSEAL_BUILD_VERSION;
  const metadataVersion = environment.CF_VERSION_METADATA.tag || environment.CF_VERSION_METADATA.id;
  // Staging intentionally uses its named environment version. Production
  // deployments inject the exact Git SHA through deploy-worker.mts; the
  // metadata tag remains the fallback for manually uploaded versions.
  const version = environment.PRIORSEAL_ENVIRONMENT === 'staging'
    ? configuredVersion || metadataVersion
    : configuredVersion && /^[0-9a-f]{40}$/.test(configuredVersion)
      ? configuredVersion
      : metadataVersion;
  return {
    ...environment,
    PRIORSEAL_RUNTIME: 'cloudflare-workers',
    PRIORSEAL_DATABASE_BACKEND: 'd1',
    PRIORSEAL_BUILD_VERSION: version,
  };
}

/**
 * R2 is optional. Without the binding, archive writes keep the D1 entry_json
 * path; only existing R2-backed rows fail closed with
 * ARCHIVE_STORAGE_NOT_CONFIGURED when read.
 */
export function evidenceBucketBinding(environment: Env): R2Bucket | null {
  const binding = (environment as Env & { EVIDENCE_BUCKET?: R2Bucket }).EVIDENCE_BUCKET;
  return binding && typeof binding.put === 'function' && typeof binding.head === 'function' && typeof binding.get === 'function' ? binding : null;
}

export function createCloudflareRateLimiter(binding: Env['HTTP_RATE_LIMITER']) {
  if (!binding?.limit) throw new TypeError('A Cloudflare Rate Limiting binding is required');
  return {
    async allow(key: string) {
      try {
        const result = await binding.limit({ key });
        return result?.success === true;
      } catch {
        throw new PriorSealError('RATE_LIMITER_UNAVAILABLE', 'Rate limiting is temporarily unavailable');
      }
    },
  };
}
