# Insight Solana Swap Guard binding

This adapter extends the guard-binding family to Insight's Solana Swap Guard
(Orca Whirlpool USDC/USDT, mainnet), following the same discipline as the
Base swap guard: Insight signs a short-lived `ALLOW` for one exact unsigned
transaction message, PriorSeal binds exactly that message into an
authorization, and the loop closes against Insight's Ed25519 settlement.

## Consumer workflow

```ts
import {
  buildSolanaSwapGuardBoundIntent,
  verifyInsightSolanaSwapGuardDecision,
  verifySolanaSwapGuardAuthorizationBinding,
  verifySolanaSwapGuardSettlementForDecision,
} from 'priorseal-sdk';

// Pin Insight's Solana evidence signer (32-byte base58 public key).
const trust = { trustedPublicKey: pinnedInsightSolanaKey };

// 1. Verify the signed ALLOW and its exact-message binding. The adapter
//    re-derives the decision integrity hash and independently recomputes the
//    Solana message hash from the exact serialized message bytes.
const verification = await verifyInsightSolanaSwapGuardDecision(decision, trust);

// 2. Bind exactly one reviewed message into a PriorSeal intent. The input
//    asset is the reviewed source token (USDC for usdc-to-usdt), the amount is
//    the reviewed amountInRaw, and the intent carries the decision commitment.
const intent = await buildSolanaSwapGuardBoundIntent({
  intentId: 'solana-swap-001',
  asset: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: decision.guard.market.exactSwap.amountInRaw,
  validUntil: requestedExpiry,
  transaction: decision.transaction,
}, decision, trust);

// 3. Verify an issued authorization stays within the decision scope.
const binding = await verifySolanaSwapGuardAuthorizationBinding(authorization, decision, trust);

// 4. Close: verify the decision itself, then Insight's settlement, cross-bind
//    the two, and —
//    the strongest local check — Ed25519-verify the on-chain fee-payer
//    signature over the attested unsigned message, proving the executed
//    transaction is the reviewed one with no Insight dependency.
const close = await verifySolanaSwapGuardSettlementForDecision(
  { settlement, decision },
  trust,
);
if (!close.valid) throw new Error(`CLOSE_REJECTED:${close.reason}`);
```

The executed-message check works because Solana includes a transaction only
under an Ed25519 fee-payer signature over the exact compiled message bytes.
A settlement whose transaction is not the reviewed message fails with
`EXECUTED_MESSAGE_MISMATCH` before any evidence is produced.

## Scope boundary

This is the closure for Insight's reviewed Solana profile only:
`solana-orca-whirlpool-usdc-usdt-1`, both directions, reduce-only forbidden
by the reviewed envelope. The settlement statuses `SETTLED`, `REVERTED` and
`UNRECONCILED` are all preserved as signed outcomes; unreconciled fills are
explicit, never guessed. `detectSolanaSwapGuardSettlementContradictions`
flags two verified settlements claiming one decisionHash for different
executed transactions.
