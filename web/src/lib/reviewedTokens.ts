/** Display hints only. The exact token address and atomic amount remain authoritative.
 * Base USDC: https://www.circle.com/blog/usdc-now-available-natively-on-base
 * Base WETH: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments
 */
const reviewed = [
  { chainId: 8453, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6 },
  { chainId: 8453, address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
] as const

export function reviewedToken(chainId: number, address: string, observedDecimals: number) {
  return reviewed.find((token) => token.chainId === chainId && token.address === address.toLowerCase() && token.decimals === observedDecimals) ?? null
}
