# Insight Hyperliquid Perp Guard binding

Hyperliquid orders are not EVM transactions: the caller signs a specialised L1
action envelope in their own wallet process. Insight's Hyperliquid Perp Guard
therefore signs risk-assessment evidence about one exact *unsigned* IOC order
envelope, and this adapter binds that signed assessment to a PriorSeal
authorization for the same envelope — one order, IOC-only, `reduceOnly`
forbidden, no field substitution after assessment.

## Consumer workflow

```ts
import {
  buildHyperliquidPerpGuardBoundIntent,
  buildHyperliquidPerpGuardSubmission,
  verifyHyperliquidPerpGuardAuthorizationBinding,
  verifyInsightHyperliquidPerpGuardDecision,
} from 'priorseal-sdk';

// 1. Verify the signed assessment: strict envelope shape, binding re-derivation
//    (intent hash, implied notional), decision integrity hash, EIP-712
//    attester signature, key-registry trust, and both expiry windows
//    (attestation ≤ 300 s, envelope inside the reviewed 5–120 s window).
const verification = await verifyInsightHyperliquidPerpGuardDecision(
  decision,
  { keyRegistry: pinnedInsightKeys },
);
if (!verification.valid) throw new Error(`REJECTED:${verification.reason}`);

// 2. Bind the exact reviewed envelope into a PriorSeal intent. The account is
//    the Hyperliquid main account that will sign the L1 action; the envelope
//    itself (asset index, side, price, size, cloid, expiry) is fixed by the
//    decision and must match canonical-for-canonical.
const intent = await buildHyperliquidPerpGuardBoundIntent({
  intentId: 'hyperliquid-perp-001',
  account: userMainAccount,
  amount: policyCounterUnits,
  nonce: actionNonceMs,          // chosen at signing time, within 120 s of the envelope expiry
  validUntil: requestedExpiry,  // capped to attestation and envelope windows
}, decision, { keyRegistry: pinnedInsightKeys });

// 3. Verify an issued authorization retains the exact reviewed envelope.
await verifyHyperliquidPerpGuardAuthorizationBinding(authorization, decision, {
  keyRegistry: pinnedInsightKeys,
});

// 4. Serialize into the exact unsigned exchange action for the user-controlled
//    wallet to sign and submit with Hyperliquid's official SDK. No signature,
//    vault address, or transport is ever produced here.
const submission = buildHyperliquidPerpGuardSubmission(intent);
```

## Honesty boundaries

- Insight signs risk assessment only. The `decisionHash` is not a user
  authorization; PriorSeal creates the authorization, and the user's wallet
  signs the exchange action.
- Builder-fee envelopes fail closed in the intent builder
  (`HYPERLIQUID_PERP_GUARD_BUILDER_FEE_NOT_SUPPORTED`): the intent schema does
  not carry a builder fee yet, and silently dropping one would authorize more
  than Insight reviewed. Builder-fee support is a deliberate follow-up.
- The nonce is deliberately not part of Insight's binding; it is chosen by the
  signer at signing time and constrained to the reviewed envelope window.
- Observation, receipts and evidence export for perp IOC orders reuse the
  Hyperliquid spot IOC observation profile (cloid-based `orderStatus` /
  `userFillsByTime`); see [integrations/hyperliquid.md](integrations/hyperliquid.md).
