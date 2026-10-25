# Insight Monad Lending Guard binding

This adapter keeps three independent facts separate:

1. Insight signs a five-minute Monad lending-risk decision for one exact direct call.
2. The user signs a PriorSeal authorization with that same call hash and one unique `insight.monad-lending-guard.v1` commitment.
3. PriorSeal observes the submitted call and issues a receipt.

```ts
import {
  buildMonadLendingGuardBoundIntent,
  monadLendingGuardIntentAsset,
  verifyMonadLendingGuardAuthorizationBinding,
  verifyMonadLendingGuardReceiptBundle,
} from "priorseal-sdk";

const intent = await buildMonadLendingGuardBoundIntent(
  {
    transaction: exactUnsignedTransaction,
    intentId: "monad-lending-2026-10-25-001",
    asset: monadLendingGuardIntentAsset("aave-v3-monad"),
    amount: decision.action.amount,
    validUntil: requestedExpiry,
  },
  decision,
  { keyRegistry: pinnedInsightKeys },
);
```

The adapter independently verifies the Insight EIP-712 signature and signer trust epoch, requires an `ALLOW`, rejects an altered chain/sender/target/calldata/nonce/value or duplicate namespace, and limits the authorization expiry to Insight's deadline. It supports only the reviewed direct Monad Aave V3 and Morpho Blue forms. It does not turn an x402 payment or an Insight assessment into transaction authority.
