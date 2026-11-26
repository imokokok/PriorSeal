import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSwapDecisionMatchesRequest } from '../src/swap-request-binding.ts'

const request = {
  guard: {
    profileId: 'base-pancakeswap-v3-usdc-usdt-100',
    direction: 'token0-to-token1' as const,
    amountIn: '1.0',
    recipient: '0x1111111111111111111111111111111111111111',
    deadlineUnixSeconds: 200,
    sourceDecisionPriceUsd: 1,
    destinationDecisionPriceUsd: 1,
    policy: { maxSlippageBps: 50 },
  },
}

function decision() {
  return {
    guard: {
      verdict: 'ALLOW',
      validUntil: 190,
      scope: { profileId: request.guard.profileId, chainId: 8453 },
      policy: { maxSlippageBps: 50 },
      market: { sourceAsset: 'USDC', destinationAsset: 'USDT', exactInput: { amountInRaw: '1000000' } },
      oracleChecks: {
        source: { decisionPriceUsd: 1 },
        destination: { decisionPriceUsd: 1 },
      },
      binding: { recipient: request.guard.recipient },
    },
  }
}

test('swap request binding accepts a decision that matches amount, direction, prices, and deadline', () => {
  assert.doesNotThrow(() => assertSwapDecisionMatchesRequest(decision(), request))
})

test('swap request binding rejects a different signed amount', () => {
  const value = decision()
  value.guard.market.exactInput.amountInRaw = '2000000'
  assert.throws(() => assertSwapDecisionMatchesRequest(value, request), /INSIGHT_DECISION_REQUEST_MISMATCH/)
})

test('swap request binding rejects a different signed direction', () => {
  const value = decision()
  value.guard.market.sourceAsset = 'USDT'
  value.guard.market.destinationAsset = 'USDC'
  assert.throws(() => assertSwapDecisionMatchesRequest(value, request), /INSIGHT_DECISION_REQUEST_MISMATCH/)
})

test('swap request binding rejects different oracle input prices', () => {
  const value = decision()
  value.guard.oracleChecks.source.decisionPriceUsd = 2
  assert.throws(() => assertSwapDecisionMatchesRequest(value, request), /INSIGHT_DECISION_REQUEST_MISMATCH/)
})

test('swap request binding rejects a decision that outlives the requested deadline', () => {
  const value = decision()
  value.guard.validUntil = 201
  assert.throws(() => assertSwapDecisionMatchesRequest(value, request), /INSIGHT_DECISION_REQUEST_MISMATCH/)
})

test('swap request binding respects profile token decimals for reversed inputs', () => {
  const reverseRequest = {
    guard: {
      ...request.guard,
      profileId: 'base-aerodrome-slipstream-weth-usdc-cl100',
      direction: 'token1-to-token0' as const,
      amountIn: '0.000001',
    },
  }
  const reverseDecision = decision()
  reverseDecision.guard.scope.profileId = reverseRequest.guard.profileId
  reverseDecision.guard.market.sourceAsset = 'USDC'
  reverseDecision.guard.market.destinationAsset = 'WETH'
  reverseDecision.guard.market.exactInput.amountInRaw = '1'
  reverseDecision.guard.oracleChecks.source.decisionPriceUsd = 1
  assert.doesNotThrow(() => assertSwapDecisionMatchesRequest(reverseDecision, reverseRequest))
})
