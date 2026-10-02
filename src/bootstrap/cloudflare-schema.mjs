// Generated from cloudflare-schema.mts by npm run core:build. Do not edit directly.
const SCHEMA_CACHE_TTL_MS = 3e5;
function createSchemaGuard(now = Date.now) {
  const readyUntil = /* @__PURE__ */ new Map();
  return async (database, config, context, cache) => {
    const cacheUrl = `https://priorseal.internal/schema/d1-0001/${config.preExecutionProofMode}/${config.archiveCredentials ? "archive" : "public"}`;
    const currentTime = now();
    if ((readyUntil.get(cacheUrl) ?? 0) > currentTime) return;
    const cacheKey = new Request(cacheUrl);
    const cached = await cache.match(cacheKey);
    if (cached) {
      const checkedAt2 = Number(cached.headers.get("x-schema-checked-at"));
      if (Number.isSafeInteger(checkedAt2) && checkedAt2 > 0 && checkedAt2 <= currentTime && checkedAt2 + SCHEMA_CACHE_TTL_MS > currentTime) {
        readyUntil.set(cacheUrl, checkedAt2 + SCHEMA_CACHE_TTL_MS);
      }
      return;
    }
    const required = ["authorization_log", "authorization_log_merkle_nodes", "authorizations", "observation_jobs", "receipts"];
    if (config.archiveCredentials) required.push("project_evidence_archive");
    if (config.preExecutionProofMode === "witness-quorum") required.push("witness_attestations");
    const rows = await database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${required.map(() => "?").join(",")})`).bind(...required).all();
    if (rows.results.length !== required.length) throw new TypeError("Required D1 production tables are missing");
    const checkedAt = now();
    readyUntil.set(cacheUrl, checkedAt + SCHEMA_CACHE_TTL_MS);
    context.waitUntil(cache.put(cacheKey, new Response("ready", { headers: { "cache-control": "public, max-age=300", "x-schema-checked-at": String(checkedAt) } })));
  };
}
export {
  createSchemaGuard
};
