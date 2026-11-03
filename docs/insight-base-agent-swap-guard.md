# Insight Base Agent Swap Guard binding

This adapter completes the narrow Base DEX path without granting either
service wallet authority:

1. Insight signs a live, short-lived `ALLOW` for one exact ERC-20 approval and
   one exact direct-router swap.
2. PriorSeal verifies Insight's published EIP-712 attester and constructs two
   different user authorizations: approval at nonce `N`, then swap at `N + 1`.
3. The executor observes the approval before submitting the separately
   authorized swap, and PriorSeal issues a receipt for each call.
4. A reviewer verifies both receipts plus the original signed Insight decision.

A self-contained offline reference of the full assess → bind → authorize →
observe → review loop, with deterministic demo keys and a machine-readable
report, ships as
[examples/insight-base-agent-swap-guard-reference-v1](../examples/insight-base-agent-swap-guard-reference-v1/README.md).

The prior approval call is not an arbitrary allowance: it targets the source
token contract, carries Insight's exact `approve(router, amount)` calldata,
uses the same source-token amount as the swap, and expires with the swap. A
router-addressed `approve` transaction, a multicall, a permit, a changed
recipient, a different token amount, non-adjacent nonces, or split expiry is
rejected before a user authorization can be prepared.

## Consumer workflow

Pin Insight's key registry independently and pass the signed `decision` from
`prepare_base_agent_swap_guard` to the SDK. `attestation` must be present and
valid; an unsigned `ALLOW` is not a portable authorization input.

```ts
import {
  baseAgentSwapGuardIntentAsset,
  buildBaseAgentSwapGuardBoundIntents,
  verifyBaseAgentSwapGuardAuthorizationBundle,
  verifyBaseAgentSwapGuardReceiptBundle,
} from 'priorseal-sdk';

const sourceAsset = baseAgentSwapGuardIntentAsset(
  decision.guard.binding.approval.token,
);

const { approval, swap } = await buildBaseAgentSwapGuardBoundIntents(
  {
    approval: {
      transaction: {
        chainId: 8453,
        from: walletAddress,
        to: decision.guard.transactionsToSign.approval.to,
        data: decision.guard.transactionsToSign.approval.data,
        nonce: currentNonce,
        value: '0',
      },
      intentId: 'base-swap-approval-001',
      asset: sourceAsset,
      amount: decision.guard.binding.approval.amountRaw,
      validUntil: requestedSharedExpiry,
    },
    swap: {
      transaction: {
        chainId: 8453,
        from: walletAddress,
        to: decision.guard.transactionsToSign.swap.to,
        data: decision.guard.transactionsToSign.swap.data,
        nonce: String(BigInt(currentNonce) + 1n),
        value: '0',
      },
      intentId: 'base-swap-exact-input-001',
      asset: sourceAsset,
      amount: decision.guard.binding.approval.amountRaw,
      validUntil: requestedSharedExpiry,
    },
  },
  decision,
  { keyRegistry: pinnedInsightKeys },
);

// Obtain two normal PriorSeal user authorizations, then verify as a pair.
const authorizationCheck = await verifyBaseAgentSwapGuardAuthorizationBundle(
  { approval: approvalAuthorization, swap: swapAuthorization, decision },
  { keyRegistry: pinnedInsightKeys },
);

// Submit only after the relevant authorization is accepted and the user has
// confirmed it. Observe successful approval before submitting the swap.
const receiptCheck = await verifyBaseAgentSwapGuardReceiptBundle({
  approvalReceipt,
  swapReceipt,
  decision,
  insightTrust: { keyRegistry: pinnedInsightKeys },
  priorSealTrust: { trustedKeys: pinnedPriorSealKeys },
});
```

`buildBaseAgentSwapGuardBoundIntents` caps the shared intent expiry to the
Insight attestation expiry. `verifyBaseAgentSwapGuardAuthorizationBundle` also
rejects an authorization whose own expiry outlives the Insight decision.

## Scope boundary

This is the closure for Insight's current Base direct-call profiles only:
Aerodrome Slipstream WETH→USDC CL100 and PancakeSwap V3 USDC→USDT 0.01%.
It does not add support for aggregators, permits, native token input,
multicalls, smart-account UserOperations, arbitrary approval patterns, or an
automatic execution authority. A valid evidence bundle proves bounded signed
claims and observed executions; it does not guarantee price, fill, MEV
protection, allowance safety outside the exact call, or token security.
