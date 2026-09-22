// Generated from chains.mts by npm run core:build. Do not edit directly.
const SUPPORTED_CHAINS = Object.freeze({
  1: { name: "Ethereum", rpcEnv: "PRIORSEAL_RPC_ETHEREUM" },
  8453: { name: "Base", rpcEnv: "PRIORSEAL_RPC_BASE" },
  84532: { name: "Base Sepolia", rpcEnv: "PRIORSEAL_RPC_BASE_SEPOLIA" },
  42161: { name: "Arbitrum", rpcEnv: "PRIORSEAL_RPC_ARBITRUM" }
});
function getRpcUrls(chainId, env = process.env) {
  const chain = SUPPORTED_CHAINS[Number(chainId)];
  if (!chain) return null;
  const value = env[chain.rpcEnv];
  return typeof value === "string" ? value.split(",").map((x) => x.trim()).filter(Boolean) : [];
}
export {
  SUPPORTED_CHAINS,
  getRpcUrls
};
