// Generated from rate-limiter.mts by npm run core:build. Do not edit directly.
function createMemoryRateLimiter({ limit = 60, windowMs = 6e4 } = {}) {
  const buckets = /* @__PURE__ */ new Map();
  return { allow(key, now = Date.now()) {
    const bucket = Math.floor(now / windowMs);
    const compound = `${key}:${bucket}`;
    if (buckets.size > 2e4) {
      for (const [item] of buckets) if (!item.endsWith(`:${bucket}`)) buckets.delete(item);
    }
    const count = (buckets.get(compound) ?? 0) + 1;
    buckets.set(compound, count);
    return count <= limit;
  } };
}
export {
  createMemoryRateLimiter
};
