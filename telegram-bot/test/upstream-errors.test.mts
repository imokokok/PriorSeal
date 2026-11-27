import assert from 'node:assert/strict'
import test from 'node:test'
import { upstreamAssessmentFailure, upstreamHttpError, upstreamTransportError } from '../src/upstream-errors.ts'

const fallback = 'generic fallback'

test('reports an unreachable Insight assessment service separately from a generic failure', () => {
  assert.match(upstreamAssessmentFailure(upstreamTransportError('INSIGHT'), fallback), /Could not reach Insight/)
})

test('reports an unreachable trusted key registry separately from Insight', () => {
  assert.match(upstreamAssessmentFailure(upstreamTransportError('KEY_REGISTRY'), fallback), /trusted key registry/)
})

test('explains Insight HTTP failures that operators can act on', () => {
  assert.match(upstreamAssessmentFailure(upstreamHttpError(new Response(null, { status: 402 })), fallback), /credits or payment/)
  assert.match(upstreamAssessmentFailure(upstreamHttpError(new Response(null, { status: 401 })), fallback), /API credentials/)
  assert.match(upstreamAssessmentFailure(upstreamHttpError(new Response(null, { status: 503 })), fallback), /temporarily unavailable/)
})

test('reports missing Insight and key registry routes separately', () => {
  assert.match(upstreamAssessmentFailure(upstreamHttpError(new Response(null, { status: 404 })), fallback), /assessment endpoint was not found/)
  assert.match(upstreamAssessmentFailure(upstreamHttpError(new Response(null, { status: 404 }), 'KEY_REGISTRY'), fallback), /key registry endpoint was not found/)
})

test('honors a bounded Retry-After interval for Insight rate limits', () => {
  const error = upstreamHttpError(new Response(null, { status: 429, headers: { 'retry-after': '25' } }))
  assert.match(upstreamAssessmentFailure(error, fallback), /Retry in about 25 seconds/)
})
