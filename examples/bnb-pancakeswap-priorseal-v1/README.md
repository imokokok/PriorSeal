# BNB PancakeSwap V3 + PriorSeal reference

This is a deterministic, offline reference for the narrow BNB Smart Chain
PancakeSwap V3 direct-call path:

1. Insight has already returned a signed `ALLOW` decision for
   `bnb-pancakeswap-v3-usdt-usdc-100`.
2. PriorSeal binds the exact approval to nonce `N` and the exact swap to nonce
   `N + 1` with the same source amount, recipient, calldata and expiry.
3. The principal signs both intents independently.
4. The executor observes approval before swap and retains both receipts.
5. A changed swap calldata is rejected by the binding layer.

Run it with:

```bash
npm run sdk:build
node examples/bnb-pancakeswap-priorseal-v1/verify.mjs
```

The example uses synthetic addresses, deterministic demo keys and short
calldata. It never connects to an RPC, requests a wallet signature, submits a
transaction, or handles a real private key. It demonstrates the evidence
boundary; it is not a price quote, token audit, route optimizer, or execution
authority.

The public SDK function is `buildAgentSwapGuardBoundIntents`. The older
`buildBaseAgentSwapGuardBoundIntents` export remains available for existing
integrations. The BNB-specific semantic MCP entrypoint is
`prepare_bnb_pancakeswap_v3_guard`.
