import type { loadRuntimeConfig } from './runtime-config.mjs';

const SCHEMA_CACHE_TTL_MS = 300_000;
type Config = ReturnType<typeof loadRuntimeConfig>;

/** Cache only successful schema readiness, with the same expiry as the edge cache. */
export function createSchemaGuard(now: () => number = Date.now) {
  const readyUntil = new Map<string, number>();
  return async (database: D1Database, config: Config, context: ExecutionContext, cache: Cache) => {
    const cacheUrl = `https://priorseal.internal/schema/d1-0001/${config.preExecutionProofMode}/${config.archiveCredentials ? 'archive' : 'public'}`;
    const currentTime = now();
    if ((readyUntil.get(cacheUrl) ?? 0) > currentTime) return;
    const cacheKey = new Request(cacheUrl);
    const cached = await cache.match(cacheKey);
    if (cached) {
      const checkedAt = Number(cached.headers.get('x-schema-checked-at'));
      if (Number.isSafeInteger(checkedAt) && checkedAt > 0 && checkedAt <= currentTime && checkedAt + SCHEMA_CACHE_TTL_MS > currentTime) {
        readyUntil.set(cacheUrl, checkedAt + SCHEMA_CACHE_TTL_MS);
      }
      return;
    }

    const required = ['authorization_log', 'authorization_log_merkle_nodes', 'authorizations', 'observation_jobs', 'receipts'];
    if (config.archiveCredentials) required.push('project_evidence_archive');
    if (config.preExecutionProofMode === 'witness-quorum') required.push('witness_attestations');
    const rows = await database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${required.map(() => '?').join(',')})`).bind(...required).all<{ name: string }>();
    if (rows.results.length !== required.length) throw new TypeError('Required D1 production tables are missing');
    const checkedAt = now();
    readyUntil.set(cacheUrl, checkedAt + SCHEMA_CACHE_TTL_MS);
    context.waitUntil(cache.put(cacheKey, new Response('ready', { headers: { 'cache-control': 'public, max-age=300', 'x-schema-checked-at': String(checkedAt) } })));
  };
}
