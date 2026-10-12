# send21 payment draft × PriorSeal payload-level binding (v1)

This example defines the payload-level binding between a public send21 payment
draft and a PriorSeal exact-call authorization: three named context commitments
(`send21:draft_id`, `send21:draft_core_sha256`, `send21:quote_sha256`) computed
from the draft the payer actually saw and acted on. A companion fixture in the
style of [`payment-draft-base-sepolia-v1`](../payment-draft-base-sepolia-v1/)
(signatures, on-chain verification, negative vectors) can now be recorded
against these commitments.

The shapes were reviewed in public on
[PriorSeal discussion #7](https://github.com/imokokok/PriorSeal/discussions/7):
send21io agreed to the second worked example on 11 October 2026 (comment
18860992), corrected two rule statements on 12 October 2026 (comment 18865940),
and reviewed the payload shapes with a green light (comment 18867355). The
recorded source is the same demo draft `66238009-a717-4746-96c5-4b2b013d7f3a`
confirmed by send21io in comment 18579696 (24 September 2026).

## Compute

```sh
node examples/send21-payment-draft-binding-v1/compute-commitments.mjs
node examples/send21-payment-draft-binding-v1/compute-commitments.mjs --verify
```

`--verify` exits 0 iff the three commitments match the pinned v0.1 test vectors:

| Commitment | Value |
|---|---|
| `send21:draft_id` | `0x8630b82de87bf5286f7204695a782ab635097fa2326c19940252a397c6c84483` |
| `send21:draft_core_sha256` | `0xb23c978eab03071d5076f2de9eef1030f7edf6d1a64a4ae2b0f078eb8c9a37e7` |
| `send21:quote_sha256` | `0xba377e399d14f4ed1c924d655adbd50fc538957b4b77b644899bd41a0729d8ec` |

## What is committed

**`draft_core`** (include-list): `id`, `network`, `currency`, `receiverAddress`,
`tokenAddress`, `amountBaseUnits`, `paymentUri`, `createdAtEpoch`,
`expiresAtEpoch`. `amountFormatted` is excluded — display-only and
format-variable; `amountBaseUnits` is the fact. `paymentUri` is derived but kept:
it MUST be constructed from the same base units. Mutable execution state
(`status`, `paidTxId`, confirmation counters) never enters a hash; it lives in
the v3 receipt's execution-state layer as a send21 status snapshot with
`NOT_ASSESSABLE` semantics.

**`quote`** (include-list): `draftId`, `cryptoAmountBaseUnits`,
`tokenAddress`, `lockedUntilEpoch` — the locked quote the payer acted on. The
demo API has no separate quote object, so the draft's own locked amount and
expiry stand in. A re-quote produces a new quote hash and therefore a new
authorization; this is observable behavior, not hidden state.

## Canonicalization

RFC 8785 (JCS) over the include-lists; keys sort by UTF-16 code units, amounts
are base-unit safe integers. **Timestamps are normalized to epoch seconds
before hashing.** The normalization started as a workaround: two snapshots of
the same demo response serialized identical instants with different sub-second
precision (`…35.460551` vs `…35.4605510`), so hashing raw timestamp bytes would
make the commitment unstable across reads of the same draft. send21io
acknowledged the serialization inconsistency (comment 18867355) and has since
fixed it (comment 18876329): every timestamp is now UTC with exactly three
decimal places and stored truncated to milliseconds, so raw timestamp bytes are
byte-stable across reads of the same draft. The epoch normalization is kept as
belt-and-braces: the pinned v0.1 hashes are over epoch seconds and do not
change, and hashing raw strings would be safe today but would change the
canonical bytes, requiring new test vectors.

## Rules confirmed with send21io

1. **Authorization window ≤ quote expiry**: `min(quote.lockedUntil,
   draft.expiresAt)`. Draft validity is a per-draft parameter (`expiryHours`),
   not a fixed interval; only the quote lock is a fixed 15-minute window.
2. **Negative cases** (a receipt must be able to evidence each):
   1. receiver changed vs `draft_core.receiverAddress`;
   2. paid amount ≠ `quote.cryptoAmountBaseUnits`;
   3. broadcast after `lockedUntil`;
   4. webhook-reported amount ≠ on-chain transfer amount;
   5. paid amount within ±10% of the quote — not rejected by send21; flagged
      `amount_mismatch` for the payee to accept or refuse. A receipt records
      that flagged status as neither confirmed nor silently dropped.

The HMAC-signed webhook (draft id, tx hash, received amount) is treated as a
send21-provided linkage snapshot, not as a cryptographic verification object.
Independent verification stays on-chain: tx hash observation, exact-call
calldata comparison, amount matching.

## Boundaries

Testnet (Base Sepolia) demo data only. This is an independent PriorSeal fixture
against a public send21 demo draft — not a send21 product integration,
endorsement, or production/custody claim. send21 did not run PriorSeal
verifiers; all verdicts are PriorSeal-side results.

send21 has since shipped server-side draft integrity (comment 18876329):
authenticated draft responses now carry a `core` object with a `coreSha256`
(JCS + SHA-256), and each rate lock is an immutable `quote` with its own hash.
Their `core` field list differs from the v0.1 include-list above (`schema`,
`paymentMethod` in; `paymentUri` out), so `coreSha256` and
`draft_core_sha256` measure different claims and do not match by design: the
v0.1 commitment is client-side (what the payer saw and acted on), the
send21 `coreSha256` is server-authoritative. Binding to `coreSha256` instead
would be a semantic upgrade for a v0.2, tracked separately.
