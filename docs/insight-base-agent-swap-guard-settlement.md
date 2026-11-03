# Insight Base Agent Swap Guard settlement closure

Insight's settlement closes the swap guard loop: after the guarded approval
and swap execute, Insight signs a
`insight.base-agent-swap-guard-settlement.v1` binding the `decisionHash` to
the executed transaction hashes, the on-chain swap calldata hash, and the
reconciled fill (amounts, price, realized slippage, explicit reason codes).

PriorSeal's SDK consumes that closure offline:

1. Independently verify the signed settlement — structural shape, the
   reason-code hash, the typed-data uid, the attester signature, and trust in
   Insight's published key registry.
2. Cross-bind the settlement to the guard decision it claims to close: same
   `decisionHash`, same reviewed chain, same recipient, and the on-chain swap
   calldata hash must equal the calldata hash the decision guarded.
3. Detect contradictions across a set of closures: two verified settlements
   claiming one `decisionHash` for different swap transactions is something no
   honest settlement can produce.

## Consumer workflow

```ts
import {
  detectInsightBaseAgentSwapGuardSettlementContradictions,
  verifyBaseAgentSwapGuardSettlementForDecision,
  verifyInsightBaseAgentSwapGuardSettlement,
} from 'priorseal-sdk';

// Standalone verification: exposes decisionHash + swapTxHash even when trust
// or signature fails, so contradiction detection works on untrusted input.
const verification = await verifyInsightBaseAgentSwapGuardSettlement(
  settlement,
  { keyRegistry: pinnedInsightKeys },
);

// The full Close step: settlement + its guard decision must agree.
const cross = await verifyBaseAgentSwapGuardSettlementForDecision(
  { settlement, decision },
  { keyRegistry: pinnedInsightKeys },
);
if (!cross.valid) throw new Error(`CLOSE_REJECTED:${cross.reason}`);

// Archive-side sweep: prove no decision was settled twice.
const report = await detectInsightBaseAgentSwapGuardSettlementContradictions(
  archivedSettlements,
  { keyRegistry: pinnedInsightKeys },
);
if (!report.consistent) {
  // report.contradictions[].swapTxHashes / indices identify the conflict.
}
```

## Honesty boundaries

- The decision may have expired when the settlement is issued: closure is a
  historical fact, not a forward authorization. Insight reports it via the
  `DECISION_EXPIRED_AT_CLOSURE` reason code.
- Amounts Insight could not attribute are signed as empty strings with an
  explicit reason code — never zeros, never guesses. A reverted swap is a real
  signable outcome (`REVERTED`), not a collection failure.
- The settlement certifies "the executed bytes were the guarded bytes and the
  fill matched the guarded quote" as reported by Insight's RPC reconciliation.
  This module re-verifies signatures and binding arithmetic locally; it does
  not re-read the chain.
- An unverifiable settlement is reported as unverified, never as a
  contradiction — the contradiction claim itself must verify first.
