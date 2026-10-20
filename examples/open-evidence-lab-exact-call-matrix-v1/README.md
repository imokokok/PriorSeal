# Open Evidence Lab — exact-call envelope matrix v1

Synthetic, offline matrix for the **first shared case** in
[probityai/agent-evidence-atlas #49](https://github.com/probityai/agent-evidence-atlas/issues/49):
*does the approved request match what actually executed?*

The published interface is `INPUT-CONTRACT.md`, contract **version 1.0.1**
(its changelog lists what changed against the pinned 1.0.0 delivery and why).
The v1.0.1 pin is accompanied by the public
[collaboration thread](https://github.com/probityai/agent-evidence-atlas/issues/64).

Answering that for a signed transaction envelope is what
`priorseal.execution-profile.exact-call.v1` does. This directory freezes one
signed authorization and six observed envelopes so two separately implemented
paths can be run against the same bytes:

| Path | Who it belongs to | What it is |
| --- | --- | --- |
| `reader.mjs` | Submission reader | A separate implementation of the published field map, authored by the fixture contributor. Imports nothing from PriorSeal — only `viem` and the Node standard library; it is not the external reviewer's reader. |
| `../../src` | PriorSeal exact-call profile | The producer: EIP-712 authorization, acceptance, envelope binding, and its own `COMPLIANT` / `NON_COMPLIANT` / `NOT_ASSESSABLE` vocabulary. |

`verify.mjs` runs both, compares them with each other and with `expected.json`,
and exits non-zero on any disagreement.

## Included cases

| Case | Class | Expected |
| --- | --- | --- |
| `case-00-exact-call-observed-match` | envelope-binding | `bound: true`, `COMPLIANT`, `COMPLETED` |
| `case-01-call-target-mismatch` | envelope-binding | `CALL_TARGET_MISMATCH`, `NON_COMPLIANT`, `COMPLETED` |
| `case-02-calldata-mismatch` | envelope-binding | `CALLDATA_MISMATCH`, `NON_COMPLIANT`, `COMPLETED` |
| `case-03-transaction-value-mismatch` | envelope-binding | `TRANSACTION_VALUE_MISMATCH`, `NON_COMPLIANT`, `COMPLETED` |
| `case-04-execution-evidence-unavailable` | evidence-availability | `bound: true` with `EXECUTION_UNAVAILABLE` beside it, `NOT_ASSESSABLE`, `UNDETERMINED` |
| `case-05-time-window-expired` | envelope-binding | `OUTSIDE_TIME_WINDOW` + `OUTSIDE_AUTHORIZATION_WINDOW`, `NON_COMPLIANT`, `COMPLETED` |

The five envelope-binding cases move exactly one observed field at a time while
the signed authorization, its signature and its acceptance stay valid. Case 04
is a **separate class**: the envelope itself matches, the evidence is missing,
and under contract v1.0.1 the availability code is reported beside `bound`
rather than inside the set that decides it — so it can never be scored as a
mismatch, and its `UNDETERMINED` outcome overrides any boolean conjunction of
`bound`. Case 05 (added in v1.0.1) sets `executedAt` one second past both time
windows the profile checks, which the fixture deliberately makes equal. The
outcome remains `COMPLETED` because execution is confirmed; compliance is
`NON_COMPLIANT` because it occurred outside both windows.

## Run

Node.js 22 or later. From the PriorSeal repository root:

```sh
npm ci
node examples/open-evidence-lab-exact-call-matrix-v1/verify.mjs
```

Or, equivalently, from this directory: `node verify.mjs`.

Add `--write` to refresh `report.json`. The command prints machine-readable JSON
and exits `1` unless every check passes.

Regenerate the frozen fixture from source (public deterministic test keys only):

```sh
node examples/open-evidence-lab-exact-call-matrix-v1/generate-fixture.mjs
```

## Layout

| Path | Contents |
| --- | --- |
| `INPUT-CONTRACT.md` | Published interface: EIP-712 digest and recovery rule, acceptance rule, field map, evidence rule, what is deliberately not compared |
| `expected.json` | Machine-readable matrix contract and expected results |
| `fixture/signed-authorization.json` | The exact signed authorization bytes plus the issuer acceptance |
| `fixture/public-test-keys.json` | Public test key or recovery rule for both schemes |
| `fixture/observed/*.json` | Six observed execution envelopes |
| `reader.mjs` / `reader.mts` | Lab reader (independent implementation) |
| `verify.mjs` / `verify.mts` | One-command runner |
| `generate-fixture.mts` | Deterministic fixture generator |
| `report.json` | Recorded result of the last run |
| `MANIFEST.json` | Input digests, toolchain, roles and limits |

## Trust and semantic limits

A passing local run establishes: both signature schemes verify under the
published test keys, the submission reader and the PriorSeal profile agree on
the v1.0.1-partitioned envelope binding for all six inputs, and the profile's
compliance and outcome labels match the declared expectations. Local verification
of v1.0.1 only establishes the limits stated here.

It does not establish the business meaning of the calldata, any economic
outcome, real-chain behaviour or finality, that the reader or its checks are
adopted anywhere, or any endorsement, integration or pilot between PriorSeal and
the Open Evidence Lab.

All keys here are public, deterministic **test** values. They are not secrets,
are not production custody, and must never be funded or deployed. The fixture is
synthetic: nothing in it is a chain observation.

## Attribution

The profile, its reason codes and its compliance vocabulary are PriorSeal's.
The `reader.mts` submission reader was authored by the same contributor who
prepared the fixture; the external reviewer's separately written Python
reader is linked in the v1.0.1 disposition. This collaboration does not imply
Lab adoption or endorsement.

## License

MIT, the PriorSeal repository license. See [`../../LICENSE`](../../LICENSE).
