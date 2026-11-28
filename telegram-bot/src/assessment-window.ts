export const USER_REVIEW_WINDOW_MS = 120_000
export const MAX_FIVE_MINUTE_MARKET_RESERVE_MS = 60_000
export const COLD_START_MARKET_RESERVE_MS = MAX_FIVE_MINUTE_MARKET_RESERVE_MS
export const LATENCY_SAMPLE_MINIMUM = 1_000
export const LATENCY_RESERVE_MULTIPLIER = 1.5

export function hasUsableMarketWindow(deadlineMs: number, nowMs: number, reserveMs: number): boolean {
  return Number.isFinite(deadlineMs) && Number.isSafeInteger(nowMs) && Number.isSafeInteger(reserveMs) &&
    reserveMs >= 0 && reserveMs <= MAX_FIVE_MINUTE_MARKET_RESERVE_MS &&
    deadlineMs - nowMs >= USER_REVIEW_WINDOW_MS + reserveMs
}

export function quoteExpiryMs(deadlineMs: number, nowMs: number, reserveMs: number): number | undefined {
  if (!hasUsableMarketWindow(deadlineMs, nowMs, reserveMs)) return undefined
  return Math.min(nowMs + USER_REVIEW_WINDOW_MS, deadlineMs - reserveMs)
}

export function latencyReserveMs(p999Ms: number): number | undefined {
  if (!Number.isFinite(p999Ms) || p999Ms < 0) return undefined
  const reserve = Math.ceil(p999Ms * LATENCY_RESERVE_MULTIPLIER)
  return reserve <= MAX_FIVE_MINUTE_MARKET_RESERVE_MS ? reserve : undefined
}

export function exceedsOnePriceTick(quotedPrice: number, freshPrice: number, tickSize: number): boolean {
  return !Number.isFinite(quotedPrice) || !Number.isFinite(freshPrice) || !Number.isFinite(tickSize) ||
    quotedPrice < 0 || quotedPrice > 1 || freshPrice < 0 || freshPrice > 1 || tickSize <= 0 || tickSize > 1 ||
    Math.abs(quotedPrice - freshPrice) > tickSize + Number.EPSILON * 4
}

export function priceContractEndTimeMs(slug: string): number | undefined {
  const match = /^([a-z0-9]+)-updown-(\d+)m-(\d{10,})$/i.exec(slug.trim())
  if (!match) return undefined
  const windowSeconds = Number(match[2]) * 60
  const windowStartSeconds = Number(match[3])
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 60 || !Number.isSafeInteger(windowStartSeconds)) return undefined
  const endTimeMs = (windowStartSeconds + windowSeconds) * 1_000
  return Number.isSafeInteger(endTimeMs) ? endTimeMs : undefined
}

export function currentBtcPriceContractSlug(nowMs = Date.now()): string {
  const windowSeconds = 5 * 60
  const startSeconds = Math.floor(nowMs / 1_000 / windowSeconds) * windowSeconds
  return `btc-updown-5m-${startSeconds}`
}
