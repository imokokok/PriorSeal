# Open Evidence Lab — exact-call envelope matrix v1

Synthetic, offline matrix for the **first shared case** in
[probityai/agent-evidence-atlas #49](https://github.com/probityai/agent-evidence-atlas/issues/49):
*does the approved request match what actually executed?*

Answering that for a signed transaction envelope is what
`priorseal.execution-profile.exact-call.v1` does. This directory freezes one
signed authorization and five observed envelopes so that **two independent
implementations** can be run against the same bytes:

| Path | Who it belongs to | What it is |
| --- | --- | --- |
| `reader.mjs` | Open Evidence Lab reader | A separate implementation of the published field map. Imports nothing from PriorSeal — only `viem` and the Node standard library. |
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
| `case-04-execution-evidence-unavailable` | evidence-availability | `EXECUTION_UNAVAILABLE`, `NOT_ASSESSABLE`, `UNDETERMINED` |

The four envelope-binding cases move exactly one observed field at a time while
the signed authorization, its signature and its acceptance stay valid. Case 04
is a **separate class**: it reports that the evidence is missing and makes no
agreement claim, so it can never be scored as a mismatch.

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
| `fixture/observed/*.json` | Five observed execution envelopes |
| `reader.mjs` / `reader.mts` | Lab reader (independent implementation) |
| `verify.mjs` / `verify.mts` | One-command runner |
| `generate-fixture.mts` | Deterministic fixture generator |
| `report.json` | Recorded result of the last run |
| `MANIFEST.json` | Input digests, toolchain, roles and limits |

## Trust and semantic limits

A passing run establishes: both signature schemes verify under the published
test keys, the Lab reader and the PriorSeal profile produce the same envelope
binding on all five inputs, and the profile's compliance and outcome labels
match the declared expectations.

It does not establish the business meaning of the calldata, any economic
outcome, real-chain behaviour or finality, that the reader or its checks are
adopted anywhere, or any endorsement, integration or pilot between PriorSeal and
the Open Evidence Lab.

All keys here are public, deterministic **test** values. They are not secrets,
are not production custody, and must never be funded or deployed. The fixture is
synthetic: nothing in it is a chain observation.

## Attribution

The profile, its reason codes and its compliance vocabulary are PriorSeal's. The
reader and the comparison are the Lab side's. Neither result is evidence about
the other party.

## License

MIT, the PriorSeal repository license. See [`../../LICENSE`](../../LICENSE).
