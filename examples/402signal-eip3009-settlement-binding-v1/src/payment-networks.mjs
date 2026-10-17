// Generated from payment-networks.mts by npm run core:build. Do not edit directly.
const NETWORK_PROFILES = {
  "eip155:8453": {
    network: "eip155:8453",
    chainId: 8453,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    assetSymbol: "USDC",
    assetDecimals: 6,
    eip712Name: "USD Coin",
    eip712Version: "2"
  },
  "eip155:42161": {
    network: "eip155:42161",
    chainId: 42161,
    asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    assetSymbol: "USDC",
    assetDecimals: 6,
    eip712Name: "USD Coin",
    eip712Version: "2"
  }
};
function getEvmPaymentNetworkProfile(network) {
  if (typeof network !== "string" || !/^eip155:(0|[1-9][0-9]*)$/.test(network)) return null;
  return NETWORK_PROFILES[network] ?? null;
}
function getEvmPaymentNetworkProfileForAsset(network, asset) {
  const profile = getEvmPaymentNetworkProfile(network);
  if (!profile || typeof asset !== "string" || asset.toLowerCase() !== profile.asset.toLowerCase()) return null;
  return profile;
}
export {
  getEvmPaymentNetworkProfile,
  getEvmPaymentNetworkProfileForAsset
};
