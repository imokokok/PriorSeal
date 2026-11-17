import { keccak256, toBytes } from 'viem'

import type { ExactCallIntentInput } from './types.js'

/** BNB Smart Chain mainnet. */
export const PANCAKESWAP_BNB_CHAIN_ID = 56 as const

/** Canonical PancakeSwap V2 router documented for BNB Smart Chain. */
export const PANCAKESWAP_BNB_V2_ROUTER = '0x10ed43c718714eb63d5aa57b78b54704e256024e' as const
/** Canonical PancakeSwap SmartRouter documented for BNB Smart Chain. */
export const PANCAKESWAP_BNB_SMART_ROUTER = '0x13f4ea83d0bd40e75c8222255bc855a974568dd4' as const

export const PANCAKESWAP_BNB_V2_PROFILE = 'bnb-pancakeswap-v2-exact-input' as const
export const PANCAKESWAP_BNB_SMART_ROUTER_PROFILE = 'bnb-pancakeswap-smart-router-exact-input' as const

export type PancakeSwapBnbProfile =
  | typeof PANCAKESWAP_BNB_V2_PROFILE
  | typeof PANCAKESWAP_BNB_SMART_ROUTER_PROFILE

export type PancakeSwapBnbCall = Pick<ExactCallIntentInput['transaction'], 'chainId' | 'from' | 'to' | 'data' | 'value'>

type ProfileSpec = {
  profileId: PancakeSwapBnbProfile
  router: string
  selectors: readonly string[]
}

const selector = (signature: string): string => keccak256(toBytes(signature)).slice(0, 10).toLowerCase()

const PROFILE_SPECS: Readonly<Record<PancakeSwapBnbProfile, ProfileSpec>> = {
  [PANCAKESWAP_BNB_V2_PROFILE]: {
    profileId: PANCAKESWAP_BNB_V2_PROFILE,
    router: PANCAKESWAP_BNB_V2_ROUTER,
    selectors: [selector('swapExactTokensForTokens(uint256,uint256,address[],address,uint256)')],
  },
  [PANCAKESWAP_BNB_SMART_ROUTER_PROFILE]: {
    profileId: PANCAKESWAP_BNB_SMART_ROUTER_PROFILE,
    router: PANCAKESWAP_BNB_SMART_ROUTER,
    selectors: [
      selector('swapExactTokensForTokens(uint256,uint256,address[],address,uint256)'),
      selector('exactInput((bytes,address,uint256,uint256))'),
      selector('exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))'),
    ],
  },
}

/** Return the reviewed router and selector boundary for a named BNB profile. */
export function pancakeSwapBnbProfile(profileId: string): ProfileSpec {
  const profile = PROFILE_SPECS[profileId as PancakeSwapBnbProfile]
  if (!profile) throw new TypeError(`Unknown BNB PancakeSwap profile: ${profileId}`)
  return profile
}

/**
 * Validate the final unsigned call before it enters the generic exact-call
 * authorization flow. This does not decode or rewrite route parameters: the
 * complete calldata remains bound by PriorSeal and must be supplied unchanged
 * to the wallet. Native-value and multicall variants stay outside this profile.
 */
export function assertPancakeSwapBnbExactInputCall(call: PancakeSwapBnbCall, profileId: string): PancakeSwapBnbProfile {
  const profile = pancakeSwapBnbProfile(profileId)
  if (call.chainId !== PANCAKESWAP_BNB_CHAIN_ID) throw new TypeError('BNB PancakeSwap call must target chain 56')
  if (typeof call.from !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(call.from)) throw new TypeError('BNB PancakeSwap call sender is invalid')
  if (typeof call.to !== 'string' || call.to.toLowerCase() !== profile.router) throw new TypeError(`BNB PancakeSwap call target must be ${profile.router}`)
  if (String(call.value ?? '0') !== '0') throw new TypeError('BNB PancakeSwap exact-input profile does not admit native-value swaps')
  if (typeof call.data !== 'string' || !/^0x[0-9a-fA-F]{8,}$/.test(call.data)) throw new TypeError('BNB PancakeSwap calldata is invalid')
  if (!profile.selectors.includes(call.data.slice(0, 10).toLowerCase())) throw new TypeError(`BNB PancakeSwap calldata selector is not admitted for ${profile.profileId}`)
  return profile.profileId
}

/** The approval spender must be the same reviewed router as the swap target. */
export function assertPancakeSwapBnbApprovalSpender(spender: string, profileId: string): void {
  const profile = pancakeSwapBnbProfile(profileId)
  if (typeof spender !== 'string' || spender.toLowerCase() !== profile.router) throw new TypeError(`BNB PancakeSwap approval spender must be ${profile.router}`)
}

