# An Independent Cold Run of PriorSeal’s Exact-Call Fixture

**YuTao Peng · PriorSeal · October 2026**

This case records an independent, cold-start reproduction of PriorSeal’s
synthetic exact-call fixture at v1.0.0, the issues found during that review,
and the contract clarifications published in v1.0.1. It is an interoperability
and reproducibility record, not a customer deployment or security audit.

## What was reproduced

The reviewer pinned the original fixture to
`imokokok/PriorSeal@d84055319325e6eef5a0a275e0f2f78f5919bdb4`. They wrote a
Python standard-library reader from the published contract, froze its hash,
and ran it before opening PriorSeal’s reader, runner, expected results, or
recorded report. Their reader, output, and probes are preserved in the
[Open Evidence Lab run record](https://github.com/probityai/agent-evidence-atlas/tree/1c261be/docs/runs/priorseal-exact-call-matrix-v1/);
the discussion is in [Open Evidence Lab issue #49](https://github.com/probityai/agent-evidence-atlas/issues/49).

The reviewer reported:

- All **17 of 17** manifest file digests matched.
- The independently computed EIP-712 digest and recovered signer matched.
- The Ed25519 acceptance signature verified in a separate check.
- All **5 of 5** reason-code results reproduced.
- A cold run of the pinned runner exited successfully and produced output
  byte-identical to the committed `report.json`.

These results concern the exact synthetic files at the v1.0.0 pin. They do not
establish behavior outside those artifacts.

## What the review found

The useful result was the combination of reproduction and a precise boundary
report:

| Finding on v1.0.0 | v1.0.1 response |
| --- | --- |
| The contract did not specify whether `EXECUTION_UNAVAILABLE` belonged in the set that decides `bound`. The fixture and profile returned `bound: false`; the reviewer’s reading returned `bound: true` with an availability code beside it. | The contract now defines `bound` from the mismatch set only, reports availability codes separately, and says `UNDETERMINED` overrides downstream boolean aggregation. |
| The documented field map named `validUntil`, while the profile also checked the authorization `expiresAt` window. The original cases did not exercise a late execution time. | The contract documents both time paths, and case 05 sets `executedAt` after both windows so both reason codes are exercised. |
| The EIP-712 field list did not map every struct field to its source JSON path, and some JSON number/string descriptions did not match the frozen fixture. | The contract now lists the JSON paths and corrects the fixture’s JSON types. |
| The prose did not say that the implementations compare values after JavaScript `String()` coercion. | The contract now states those comparison semantics. Whether the producer should reject non-canonical forms remains an open question. |

## What v1.0.1 means

The current fixture and contract are in
[`examples/open-evidence-lab-exact-call-matrix-v1/`](../../examples/open-evidence-lab-exact-call-matrix-v1/).
The matrix records both the raw PriorSeal profile result and the v1.0.1
contract-partitioned comparison for case 04. The raw profile result remains
`bound: false` when it includes `EXECUTION_UNAVAILABLE`; the v1.0.1 comparison
reports the envelope as `bound: true` with that availability code beside it.
This revision clarifies the contract and comparison. It does not claim that
the producer’s raw output was changed.

The v1.0.1 local report records **6/6 PASS** for its six synthetic cases. The
independent review above was run against v1.0.0, so **v1.0.1 still needs its
own independent cold run**. The published v1.0.1 commit and any later external
run should be linked here and in the collaboration thread.

## Reproduce and scope

From the repository root, with Node.js 22 or newer:

```sh
npm ci
node examples/open-evidence-lab-exact-call-matrix-v1/verify.mjs
```

All fixture keys are deterministic test values. The fixture is synthetic and
offline: it contains no chain observation, production key custody, or live
transaction. A pass does not establish calldata meaning, economic safety,
real-chain behavior or finality, security audit, adoption, integration, pilot,
or endorsement between PriorSeal and Open Evidence Lab.

The v1.0.0 independent reader and run remain attributed to their author in the
linked external record. The reader currently included in PriorSeal’s example
was written by the fixture contributor; it is a separate code path, not the
third-party reader.
