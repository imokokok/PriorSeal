import assert from 'node:assert/strict'
import test from 'node:test'
import { currentBtcPriceContractSlug, hasAtLeastRemainingMs, isWithinAssessmentDeadlineWindow, priceContractEndTimeMs } from '../src/assessment-window.ts'

const nowMs = 1_800_000_000_000

test('assessment deadline accepts only 90–120 seconds ahead', () => {
  assert.equal(isWithinAssessmentDeadlineWindow(nowMs + 90_000, nowMs), true)
  assert.equal(isWithinAssessmentDeadlineWindow(nowMs + 120_000, nowMs), true)
  assert.equal(isWithinAssessmentDeadlineWindow(nowMs + 89_999, nowMs), false)
  assert.equal(isWithinAssessmentDeadlineWindow(nowMs + 120_001, nowMs), false)
  assert.equal(isWithinAssessmentDeadlineWindow(Number.NaN, nowMs), false)
})

test('price contract end time is parsed safely and requires enough time remaining', () => {
  const endMs = priceContractEndTimeMs('btc-updown-5m-1800000000')
  assert.equal(endMs, 1_800_000_300_000)
  assert.equal(hasAtLeastRemainingMs(endMs!, nowMs), true)
  assert.equal(hasAtLeastRemainingMs(endMs!, endMs! - 89_999), false)
  assert.equal(priceContractEndTimeMs('what-price-will-bitcoin-hit-before-2027'), undefined)
  assert.equal(priceContractEndTimeMs('btc-updown-0m-1800000000'), undefined)
})

test('Unix-second deadlines use the same 90–120 second window after conversion', () => {
  const nowSeconds = Math.floor(nowMs / 1_000)
  assert.equal(isWithinAssessmentDeadlineWindow((nowSeconds + 90) * 1_000, nowMs), true)
  assert.equal(isWithinAssessmentDeadlineWindow((nowSeconds + 89) * 1_000, nowMs), false)
  assert.equal(isWithinAssessmentDeadlineWindow((nowSeconds + 121) * 1_000, nowMs), false)
})

test('current BTC market slug is derived from the message receive time', () => {
  assert.equal(currentBtcPriceContractSlug(nowMs), 'btc-updown-5m-1800000000')
  assert.equal(currentBtcPriceContractSlug(nowMs + 299_999), 'btc-updown-5m-1800000000')
  assert.equal(currentBtcPriceContractSlug(nowMs + 300_000), 'btc-updown-5m-1800000300')
})
