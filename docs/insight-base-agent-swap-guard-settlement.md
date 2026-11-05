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
2. Cross-bind the settlement to the guard decision it claims to close
   (the decision itself is verified first — signature, trust and binding
   arithmetic, historically, since closure is a fact about the past): same
   `decisionHash`, same reviewed chain, same recipient, and the on-chain swap
   calldata hash must equal the calldata hash the decision guarded.
3. Detect contradictions across a set of closures: two verified settlements
   claiming one `decisionHash` for different swap transactions is something no
   honest settlement can produce.

**Chains.** The closure covers the three reviewed EVM chains — Base 8453,
BNB 56 and Monad 143 (`SETTLEMENT_CHAIN_IDS`). The EIP-712 signing domain is
fixed (`chainId: 1`); the reviewed chain travels inside `data.chainId` and
must agree with the decision's scope/binding chain. The examples below use
Base mainnet; substitute the matching chain id and your own RPC for 56/143.

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

## Optional: independent chain re-read (off by default)

The settlement verification described above is **offline**. It independently
re-checks the signature, the typed-data uid, the reason-code hash and the
decision↔settlement binding, but it **does not re-read the chain**: the factual
layer — `swapTxHash`, `onChainSwapCalldataHash`, `fillStatus`,
`sourceAmountRaw`, `destinationAmountRaw`, `blockNumber` and `executedPrice` —
is **inherited from Insight's RPC reconciliation claims**. Signature checks are
independent; those facts are not. This is the default behaviour and it is not
changed by anything in this section.

A caller can optionally close that gap for itself with
`independentlyVerifySettlement(settlement, options)`. The RPC is **supplied by
the caller** (`rpcUrl`, a viem `provider`, or a narrow `reader`); the SDK has no
built-in, default, Insight-owned or PriorSeal-owned endpoint. If no options are
passed, the re-read is simply **not performed** and returns an `UNKNOWN` result —
existing verification verdicts and output shapes are unchanged.

### How to supply your own RPC

```ts
import { independentlyVerifySettlement } from 'priorseal-sdk';

// 1. A URL you control (only its origin is recorded in results/logs; the full
//    URL, including any API key in a path/query, is never written out).
const result = await independentlyVerifySettlement(settlement, {
  rpcUrl: process.env.MY_OWN_BASE_RPC,
  chainId: 8453,
  timeoutMs: 8_000,
});

// 2. A viem public client you constructed yourself.
// const result = await independentlyVerifySettlement(settlement, {
//   provider: createPublicClient({ transport: http(myRpcUrl) }),
// });

// 3. A narrow reader (also the easiest to mock in tests).
// const result = await independentlyVerifySettlement(settlement, {
//   reader: { getChainId, getTransaction, getTransactionReceipt },
// });

if (result.verdict !== 'VERIFIED') throw new Error(`REREAD_${result.reason}`);
```

The returned `IndependentRereadResult` contains `verified`, `verdict`
(`VERIFIED` | `MISMATCH` | `UNKNOWN`), a `checks[]` list (each with
`name`/`expected`/`observed`/`pass`/`status`/`code`), `mismatches[]`,
`observedTransfers[]`, `rereadAt`, and `rpcOrigin` (scheme + host + port only).

### What becomes independently verified when enabled

Reading `swapTxHash`'s transaction and receipt from the caller's RPC, the SDK
recomputes and compares:

- `onChainSwapCalldataHash` — `keccak256` of the on-chain transaction `input`.
- `sourceAmountRaw` / `destinationAmountRaw` — the `value` of decoded ERC-20
  `Transfer` logs. The output is the log whose `to` is `recipient`; the input is
  the log paid by the transaction sender (`from`) to someone else. Optional
  `sourceToken` / `destinationToken` addresses disambiguate multiple logs.
- `recipient` — the `to` of the output `Transfer` log.
- `fillStatus` — receipt `status` (`success` → `FULL`, `reverted` → `REVERTED`).
- `blockNumber` — receipt `blockNumber`, cross-checked with the transaction's
  block number as a reorg/staleness guard.
- `chainId` — the RPC's `getChainId()`, pinned against the declaration.

Any single mismatch yields `MISMATCH`; a missing receipt/transaction, a
chain or block mismatch, an undecodable log, an RPC error or a timeout yields
`UNKNOWN`. Both are **fail-closed**: only `verdict === 'VERIFIED'` sets
`verified: true`, and no partial success is ever reported as verified.

### What still cannot be verified independently

- `executedPrice` and `realizedSlippageBps` — derived from off-chain quotes and
  reconciliation math; there is no authoritative value for them in the receipt.
  They remain inherited claims.
- `executedAt` / `checkedAt` — off-chain timestamps; the settlement carries no
  block hash/timestamp binding to compare against.
- `decisionHash`, `reasonCodesHash`, `uid`, `signature`, attester trust and the
  decision↔settlement cross-binding — cryptographic/trust layer, still handled
  by `verifyInsightBaseAgentSwapGuardSettlement` and
  `verifyBaseAgentSwapGuardSettlementForDecision`; the re-read does not replace
  them. `verified: true` means "the independently re-read chain facts agree
  with the settlement's claims", **not** "the settlement is authentic".
- `approvalTxHash` — only the swap transaction is re-read; the approval hash may
  be zero when no approval transaction was presented.
- Amounts signed as `''` (Insight could not attribute them), `REVERTED` fills
  (no successful `Transfer` logs to attribute), and receipts with several
  same-direction `Transfer` logs that cannot be disambiguated — these are
  reported as `UNKNOWN`, never guessed and never counted as verified.

`verifySettlementWithIndependentReread(settlement, options)` is an opt-in
convenience composition that runs the existing offline verification first and
returns both results. It is additive; the existing verifiers are unchanged.
