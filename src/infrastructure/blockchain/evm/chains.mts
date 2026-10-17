export const SUPPORTED_CHAINS = Object.freeze({
  0: { name: 'Solana mainnet-beta', rpcEnv: 'PRIORSEAL_RPC_SOLANA_MAINNET' },
  1: { name: 'Ethereum', rpcEnv: 'PRIORSEAL_RPC_ETHEREUM' },
  10: { name: 'OP Mainnet', rpcEnv: 'PRIORSEAL_RPC_OP_MAINNET' },
  137: { name: 'Polygon PoS', rpcEnv: 'PRIORSEAL_RPC_POLYGON' },
  143: { name: 'Monad', rpcEnv: 'PRIORSEAL_RPC_MONAD' },
  196: { name: 'X Layer', rpcEnv: 'PRIORSEAL_RPC_X_LAYER' },
  1329: { name: 'Sei', rpcEnv: 'PRIORSEAL_RPC_SEI' },
  8453: { name: 'Base', rpcEnv: 'PRIORSEAL_RPC_BASE' },
  84532: { name: 'Base Sepolia', rpcEnv: 'PRIORSEAL_RPC_BASE_SEPOLIA' },
  42161: { name: 'Arbitrum', rpcEnv: 'PRIORSEAL_RPC_ARBITRUM' },
  43114: { name: 'Avalanche C-Chain', rpcEnv: 'PRIORSEAL_RPC_AVALANCHE' },
});
export function getRpcUrls(chainId: number | string, env: object = process.env) { const chain = (SUPPORTED_CHAINS as Record<number, { name: string; rpcEnv: string }>)[Number(chainId)]; if (!chain) return null; const value = (env as Record<string, unknown>)[chain.rpcEnv]; return typeof value === 'string' ? value.split(',').map((x) => x.trim()).filter(Boolean) : []; }
