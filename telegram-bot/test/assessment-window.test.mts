import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COLD_START_MARKET_RESERVE_MS,
  LATENCY_SAMPLE_MINIMUM,
  currentBtcPriceContractSlug,
  exceedsOnePriceTick,
  hasUsableMarketWindow,
  latencyReserveMs,
  priceContractEndTimeMs,
  quoteExpiryMs,
  USER_REVIEW_WINDOW_MS,
} from '../src/assessment-window.ts'

const nowMs = 1_800_000_000_000

test('market entry preserves a two-minute review window plus the service reserve', () => {
  const deadlineMs = nowMs + 300_000
  assert.equal(hasUsableMarketWindow(deadlineMs, nowMs, COLD_START_MARKET_RESERVE_MS), true)
  assert.equal(hasUsableMarketWindow(deadlineMs, nowMs + 120_001, COLD_START_MARKET_RESERVE_MS), false)
  assert.equal(hasUsableMarketWindow(deadlineMs, nowMs, 60_001), false)
  assert.equal(hasUsableMarketWindow(deadlineMs, nowMs, Number.NaN), false)
})

test('quote TTL ends at the earlier of two minutes or market close minus reserve', () => {
  const deadlineMs = nowMs + 300_000
  assert.equal(quoteExpiryMs(deadlineMs, nowMs, 60_000), nowMs + USER_REVIEW_WINDOW_MS)
  assert.equal(quoteExpiryMs(nowMs + 180_000, nowMs, 60_000), nowMs + USER_REVIEW_WINDOW_MS)
  assert.equal(quoteExpiryMs(nowMs + 179_999, nowMs, 60_000), undefined)
})

test('latency reserve uses P99.9 margin and fails closed above the five-minute budget', () => {
  assert.equal(LATENCY_SAMPLE_MINIMUM, 1_000)
  assert.equal(latencyReserveMs(20_000), 30_000)
  assert.equal(latencyReserveMs(40_000), 60_000)
  assert.equal(latencyReserveMs(40_001), undefined)
  assert.equal(latencyReserveMs(Number.NaN), undefined)
})

test('market price drift is bounded by its live tick size', () => {
  assert.equal(exceedsOnePriceTick(0.5, 0.51, 0.01), false)
  assert.equal(exceedsOnePriceTick(0.5, 0.52, 0.01), true)
  assert.equal(exceedsOnePriceTick(0.5, 0.52, Number.NaN), true)
})

test('price contract end time is parsed safely', () => {
  const endMs = priceContractEndTimeMs('btc-updown-5m-1800000000')
  assert.equal(endMs, 1_800_000_300_000)
  assert.equal(priceContractEndTimeMs('what-price-will-bitcoin-hit-before-2027'), undefined)
  assert.equal(priceContractEndTimeMs('btc-updown-0m-1800000000'), undefined)
})

test('current BTC market slug is derived from the message receive time', () => {
  assert.equal(currentBtcPriceContractSlug(nowMs), 'btc-updown-5m-1800000000')
  assert.equal(currentBtcPriceContractSlug(nowMs + 299_999), 'btc-updown-5m-1800000000')
  assert.equal(currentBtcPriceContractSlug(nowMs + 300_000), 'btc-updown-5m-1800000300')
})
