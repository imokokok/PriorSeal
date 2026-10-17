export type EvmPaymentNetworkProfile = {
  network: `eip155:${number}`
  chainId: number
  asset: `0x${string}`
  assetSymbol: 'USDC'
  assetDecimals: 6
  eip712Name: 'USD Coin'
  eip712Version: '2'
}

const NETWORK_PROFILES = {
  'eip155:8453': {
    network: 'eip155:8453',
    chainId: 8453,
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetSymbol: 'USDC',
    assetDecimals: 6,
    eip712Name: 'USD Coin',
    eip712Version: '2',
  },
  'eip155:42161': {
    network: 'eip155:42161',
    chainId: 42161,
    asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    assetSymbol: 'USDC',
    assetDecimals: 6,
    eip712Name: 'USD Coin',
    eip712Version: '2',
  },
} as const satisfies Record<string, EvmPaymentNetworkProfile>

export function getEvmPaymentNetworkProfile(network: unknown): EvmPaymentNetworkProfile | null {
  if (typeof network !== 'string' || !/^eip155:(0|[1-9][0-9]*)$/.test(network)) return null
  return NETWORK_PROFILES[network as keyof typeof NETWORK_PROFILES] ?? null
}

export function getEvmPaymentNetworkProfileForAsset(network: unknown, asset: unknown): EvmPaymentNetworkProfile | null {
  const profile = getEvmPaymentNetworkProfile(network)
  if (!profile || typeof asset !== 'string' || asset.toLowerCase() !== profile.asset.toLowerCase()) return null
  return profile
}
