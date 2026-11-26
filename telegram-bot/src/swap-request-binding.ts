type SwapRequest = {
  guard: {
    profileId: string
    direction?: 'token0-to-token1' | 'token1-to-token0'
    amountIn: string
    recipient: string
    deadlineUnixSeconds: number
    sourceDecisionPriceUsd: number
    destinationDecisionPriceUsd: number
    policy: unknown
  }
}

type ProfileAssets = { chainId: number; token0: string; token1: string; token0Decimals: number; token1Decimals: number }

const PROFILE_ASSETS: Record<string, ProfileAssets> = {
  'base-aerodrome-slipstream-weth-usdc-cl100': { chainId: 8453, token0: 'WETH', token1: 'USDC', token0Decimals: 18, token1Decimals: 6 },
  'base-aerodrome-slipstream-usdc-usdt-cl1': { chainId: 8453, token0: 'USDC', token1: 'USDT', token0Decimals: 6, token1Decimals: 6 },
  'base-pancakeswap-v3-usdc-usdt-100': { chainId: 8453, token0: 'USDC', token1: 'USDT', token0Decimals: 6, token1Decimals: 6 },
  'bnb-pancakeswap-v3-usdt-usdc-100': { chainId: 56, token0: 'USDT', token1: 'USDC', token0Decimals: 18, token1Decimals: 18 },
  'bnb-pancakeswap-v3-usdt-wbnb-100': { chainId: 56, token0: 'USDT', token1: 'WBNB', token0Decimals: 18, token1Decimals: 18 },
  'monad-pancakeswap-v3-wmon-usdc-500': { chainId: 143, token0: 'WMON', token1: 'USDC', token0Decimals: 18, token1Decimals: 6 },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameJson(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return canonical(left) === canonical(right)
}

function decimalToRaw(value: string, decimals: number): string | null {
  const [whole, fraction = ''] = value.split('.')
  const normalizedFraction = fraction.replace(/0+$/, '')
  if (normalizedFraction.length > decimals) return null
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(normalizedFraction.padEnd(decimals, '0') || '0')).toString()
}

/** Fail closed if a trusted signed decision is valid but for different swap inputs. */
export function assertSwapDecisionMatchesRequest(decision: Record<string, unknown>, input: SwapRequest): void {
  const guard = isRecord(decision.guard) ? decision.guard : null
  const scope = guard && isRecord(guard.scope) ? guard.scope : null
  const binding = guard && isRecord(guard.binding) ? guard.binding : null
  const policy = guard && isRecord(guard.policy) ? guard.policy : null
  const market = guard && isRecord(guard.market) ? guard.market : null
  const exactInput = market && isRecord(market.exactInput) ? market.exactInput : null
  const oracleChecks = guard && isRecord(guard.oracleChecks) ? guard.oracleChecks : null
  const source = oracleChecks && isRecord(oracleChecks.source) ? oracleChecks.source : null
  const destination = oracleChecks && isRecord(oracleChecks.destination) ? oracleChecks.destination : null
  const profile = PROFILE_ASSETS[input.guard.profileId]
  if (!profile) throw new Error('INSIGHT_DECISION_REQUEST_MISMATCH')
  const reverse = input.guard.direction === 'token1-to-token0'
  const sourceAsset = reverse ? profile.token1 : profile.token0
  const destinationAsset = reverse ? profile.token0 : profile.token1
  const inputDecimals = reverse ? profile.token1Decimals : profile.token0Decimals
  const expectedAmountRaw = decimalToRaw(input.guard.amountIn, inputDecimals)

  if (!guard || !scope || !policy || scope.profileId !== input.guard.profileId || scope.chainId !== profile.chainId ||
      !sameJson(policy, input.guard.policy)) {
    throw new Error('INSIGHT_DECISION_REQUEST_MISMATCH')
  }
  if (market && (market.sourceAsset !== sourceAsset || market.destinationAsset !== destinationAsset ||
      !exactInput || expectedAmountRaw === null || exactInput.amountInRaw !== expectedAmountRaw)) {
    throw new Error('INSIGHT_DECISION_REQUEST_MISMATCH')
  }
  if ((source && source.decisionPriceUsd !== input.guard.sourceDecisionPriceUsd) ||
      (destination && destination.decisionPriceUsd !== input.guard.destinationDecisionPriceUsd)) {
    throw new Error('INSIGHT_DECISION_REQUEST_MISMATCH')
  }
  if (binding && (typeof binding.recipient !== 'string' || binding.recipient.toLowerCase() !== input.guard.recipient.toLowerCase())) {
    throw new Error('INSIGHT_DECISION_REQUEST_MISMATCH')
  }
  if (guard.verdict === 'ALLOW' && (!binding || !market || !exactInput || !oracleChecks || !source || !destination ||
      market.sourceAsset !== sourceAsset || market.destinationAsset !== destinationAsset || expectedAmountRaw === null ||
      exactInput.amountInRaw !== expectedAmountRaw ||
      source.decisionPriceUsd !== input.guard.sourceDecisionPriceUsd ||
      destination.decisionPriceUsd !== input.guard.destinationDecisionPriceUsd ||
      typeof guard.validUntil !== 'number' || guard.validUntil > input.guard.deadlineUnixSeconds)) {
    throw new Error('INSIGHT_DECISION_REQUEST_MISMATCH')
  }
}
