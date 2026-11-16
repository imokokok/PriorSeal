# Agent Swap channel adapter reference

This reference shows how a distribution adapter should hand a provider's swap
output into PriorSeal. The adapter is a channel boundary, not a new risk
engine.

## Direct reviewed Insight profiles

For a direct Base, BNB Smart Chain, or Monad profile, call the neutral Insight
entrypoint `prepare_agent_swap_guard`, preserve the exact approval and swap
calls, and use the public SDK function
`buildAgentSwapGuardBoundIntents`. The old Base-prefixed exports remain
available for compatibility.

## Uniswap and 1inch

Uniswap API and 1inch outputs must be treated as provider route proposals until
their router, Permit2, batch, intent, resolver, and settlement semantics have
been separately reviewed. Do not pass arbitrary aggregator calldata to the
direct Agent Swap Guard.

After the caller has collected the provider response and any separate Insight
`execution_preflight` evidence, the exact unsigned EVM transaction can still
be bound to a PriorSeal intent with the generic SDK primitive:

```ts
import { buildExactCallIntent } from 'priorseal-sdk'

const intent = buildExactCallIntent({
  transaction: providerUnsignedTransaction,
  intentId: 'uniswap-or-1inch-swap-001',
  asset: 'eip155:8453/erc20:0x0000000000000000000000000000000000000000',
  amount: sourceAmountRaw,
  validUntil: Math.floor(Date.now() / 1000) + 120,
})
```

The exact transaction bytes, target, value, sender, chain, nonce, amount and
expiry are bound by the intent. This does not certify the provider route,
contract code, price, solver, or fill quality; those claims require a dedicated
adapter review.

## MetaMask

MetaMask transaction or signature insight should display the existing Insight
decision, its expiry and calldata/message hash, plus the PriorSeal
authorization status. It must not rewrite the transaction or produce a second
verdict.

## CoW Protocol

CoW orders and hooks are typed order objects rather than the direct EVM call
shape. A future CoW adapter needs an order-specific typed-data binding and a
settlement collector. Until then, retain the order, quote, hooks and solver
evidence as external artifacts and do not label them as Agent Swap Guard
coverage.

## Jupiter

For a Solana Jupiter route, use the existing
`buildSolanaSwapGuardBoundIntent` only when Insight returns an approved,
reviewed route result. Bind the exact returned Solana transaction message; do
not substitute a different route after authorization.

This example is documentation only. It does not connect to an RPC, sign a
wallet transaction, or submit an order.
