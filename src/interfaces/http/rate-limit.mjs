/** Development-only fixed-window limiter. Production should inject a shared limiter. */
export function createMemoryRateLimiter({ limit = 60, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return { allow(key, now = Date.now()) { const bucket = Math.floor(now / windowMs); const compound = `${key}:${bucket}`; if (buckets.size > 20_000) for (const [item] of buckets) if (!item.endsWith(`:${bucket}`)) buckets.delete(item); const count = (buckets.get(compound) ?? 0) + 1; buckets.set(compound, count); return count <= limit; } };
}
