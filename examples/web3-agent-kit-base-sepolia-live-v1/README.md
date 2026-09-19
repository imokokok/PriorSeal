# Web3 Agent Kit × PriorSeal Base Sepolia live evidence

This directory records one real Uniswap v3 `exactInputSingle` WETH → USDC transaction on Base Sepolia. The complete transaction was constructed first, a principal-signed PriorSeal exact-call authorization was created and accepted, and only then was the transaction signed and broadcast.

The run uses Uniswap's official Base Sepolia SwapRouter02, QuoterV2 and factory addresses, Base Sepolia WETH, and Circle's Base Sepolia USDC. It uses a publicly known Hardhat development account and an ephemeral local PriorSeal issuer key, both strictly for nonproduction testing.

## Verify

```sh
npm run verify:web3-agent-kit-base-sepolia-live
npm run verify:web3-agent-kit-base-sepolia-live:online
```

Offline verification checks the bundle hash, pinned local test key, PriorSeal signatures, mandatory authorization policy, and exact target/calldata/value/nonce binding. Online verification additionally fetches the transaction and receipt from Base Sepolia and compares the chain data with the bundle.

## Boundaries

This is real testnet execution evidence, not production assurance. No live Insight API credential was available, so no live Insight C3 assessment or C4 receipt was issued. The bound chain quote is explicitly labeled `CHAIN_QUOTE_ONLY_NO_INSIGHT_ATTESTATION`; it is not a substitute for Insight risk evidence. The run does not claim economic safety, profitable execution, production key handling, mainnet behavior, or adoption by Web3 Agent Kit.

Re-running the broadcaster requires an explicit unsafe flag because it spends public-account Base Sepolia test ETH:

```sh
npm run sdk:build
node scripts/run-wak-base-sepolia-live.mjs --unsafe-public-dev-key
```
