# Insight Base Lending Guard binding

This SDK adapter composes three distinct facts without merging their trust boundaries:

1. Insight signs a short-lived Base lending risk decision for one exact direct call.
2. The user signs a PriorSeal authorization containing the same call hash and a unique `insight.base-lending-guard.v1` commitment.
3. PriorSeal observes the submitted transaction and issues a receipt.

An x402 payment covers only the Insight read-only assessment. It does not authorize a wallet, prove execution, or give either service transaction authority.

## Consumer workflow

Pin the Insight attester registry out of band, fetch an attested Insight decision, and use the SDK before asking the user for an authorization signature:

```ts
import {
  baseLendingGuardIntentAsset,
  buildBaseLendingGuardBoundIntent,
  verifyBaseLendingGuardAuthorizationBinding,
  verifyBaseLendingGuardReceiptBundle,
} from "priorseal-sdk";

const intent = await buildBaseLendingGuardBoundIntent(
  {
    transaction: exactUnsignedTransaction,
    intentId: "lending-2026-10-25-001",
    asset: baseLendingGuardIntentAsset("aave-v3-base"),
    amount: decision.action.amount,
    validUntil: requestedExpiry,
  },
  decision,
  { keyRegistry: pinnedInsightKeys },
);

// Prepare and obtain the user’s normal PriorSeal authorization next.
const binding = await verifyBaseLendingGuardAuthorizationBinding(
  authorization,
  decision,
  { keyRegistry: pinnedInsightKeys },
);

const receiptCheck = await verifyBaseLendingGuardReceiptBundle({
  receipt,
  decision,
  insightTrust: { keyRegistry: pinnedInsightKeys },
  priorSealTrust: { trustedKeys: pinnedPriorSealKeys },
});
```

The adapter rejects a missing or self-signed Insight attestation, non-`ALLOW` verdict, expired decision, changed chain/sender/target/calldata/nonce/value, ambiguous or substituted context commitment, and an authorization that outlives the decision.

## Scope boundary

The v1 adapter supports Insight’s direct Base profile only: Aave V3 Base, Morpho Blue Base, Compound V3 Base USDC Comet, and reviewed Moonwell Base markets. It admits only the exact `supply`/`borrow` forms that Insight decoded, with zero native value and no callbacks or batch/proxy dispatch. The `asset` field is the explicit non-token label `eip155:8453/lending:<protocol>` and `amount` is the exact calldata amount. This avoids falsely representing a lending operation’s protocol units as a generic token transfer.

Fluid and Euler are deliberately excluded until Insight has their vault/EVC-specific decoders and live market risk adapters. PriorSeal will reject an unrecognized protocol identifier rather than convert that gap into a generic contract-call authorization.

The signed decision still records caller-declared post-action USD values. It is not a simulation, a price guarantee, or a liquidation guarantee. Consumers must retain their own policy on position sizing, account state, and transaction submission.
