export const SUPPORTED_CHAINS = Object.freeze({
  1: { name: 'Ethereum', rpcEnv: 'RUNPROOF_RPC_ETHEREUM' },
  8453: { name: 'Base', rpcEnv: 'RUNPROOF_RPC_BASE' },
  42161: { name: 'Arbitrum', rpcEnv: 'RUNPROOF_RPC_ARBITRUM' },
});
export function getRpcUrls(chainId, env = process.env) { const chain = SUPPORTED_CHAINS[chainId]; if (!chain) return null; const value = env[chain.rpcEnv]; return value ? value.split(',').map((x) => x.trim()).filter(Boolean) : []; }
