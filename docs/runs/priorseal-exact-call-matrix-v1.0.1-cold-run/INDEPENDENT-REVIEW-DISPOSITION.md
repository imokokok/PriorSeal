# Independent review disposition — exact-call matrix v1.0.1

This note records the external reader's findings against the immutable PriorSeal
commit `2ff89d86611257b4440232e5c2793926b3d52043`. It is a post-pin disposition:
the pinned files remain unchanged. The current README corrects the case-05
summary, and the manifest is updated for that corrected README. This does not
retroactively change the pinned artifact.

The v1.0.1 contract's attribution sentence saying that an independent rerun had
not happened reflects the status when that pinned file was written. The run
records below supersede that sentence as current status; the frozen contract
file is retained byte-for-byte.

## Reproduction record

The HORIZON SHIELD / NENRIN Python reader was written from the published
contract, fixture and architecture documents without opening PriorSeal
verifier, reader, generator, SDK or application source. It reported 89
comparable fields equal, 0 different and 13 not comparable. It independently
recovered the EIP-712 signer, verified the Ed25519 acceptance and recomputed
the intent, authorization and acceptance-entry hashes. Expected values were
public and read before the run, so this was answer-exposed, not blind.

- [Independent reader report and findings](https://github.com/ogasurfproject-jpg/horizon-shield/tree/bfde94be9d80/workers/hs-ledger/nenrin/priorseal-reader-v0)
- [Original report on OEL issue #64](https://github.com/probityai/agent-evidence-atlas/issues/64#issuecomment-6144104923)
- [Independent rerun by a second operator](https://github.com/probityai/agent-evidence-atlas/issues/64#issuecomment-6155239434)
- [Fresh-clone run of the published v1.0.1 runner](https://github.com/probityai/agent-evidence-atlas/issues/64#issuecomment-6134006661)

The reported reader found no differences among the comparable computed fields.
The 13 non-comparable fields were the undefined `authorizationCode`, the
undefined `receiptClaimsValid` for a receipt not present in the fixture, and
internal `agreement` flags replaced by direct comparisons.

## Findings and disposition

| ID | Finding | Disposition |
| --- | --- | --- |
| G1 | Hash identities and canonical JSON were not defined in the v1.0.1 contract; the reader had to use a signing-bytes architecture note for another fixture. | Documented as the rule source and reproduced in the report. This matrix contract still does not independently define those identities; a future version must include or normatively reference them. |
| G2 | The authorization reference time and the meaning of `authorizationCode` were not stated. Policy admission was not established. | The reproduced fixture check is explicitly identified as being evaluated at `notBefore` (1000). `authorizationCode: OK` is not assigned broader meaning here; the zero `policyHash` and absent policy document do not prove policy admission. |
| G3 | No general compliance/outcome rule was specified. Case 04 combines `executionDataAvailable: false` with `status: NOT_FOUND`, so it cannot isolate which condition yields `UNDETERMINED`; `REVERTED` is not covered. | The case outputs are recorded as fixture results, not generalized rules. The unresolved statuses require separate vectors and normative contract text. |
| G4 | Correlation mismatches are described as not assessable in lifecycle prose, while chain/sender/nonce appear in the ordinary mismatch set. No case tests these mismatches; `intent.sender` also equals `delegate.executor` in the fixture. | Left unresolved. Do not infer whether these mismatches produce `NON_COMPLIANT` or `NOT_ASSESSABLE` from this matrix. |
| G5 | Observation envelopes do not carry an authorization identifier; fixture-to-authorization pairing comes from directory/case layout. | The matrix proves only the published synthetic pairing. It does not establish runtime authorization binding. The API's `authorizationId` request path is outside this fixture. |
| G6 | The contract leaves edge cases unclear: null/empty optional values; `String()` coercion versus strict chain ID equality; leading-zero decimal strings; missing `executionDataAvailable`; time checks when evidence is unavailable. | Left unresolved; the six vectors do not decide these semantics. Add explicit rules and discriminating cases before claiming general behavior. |
| G7 | The matrix README listed case 05 outcome as `UNDETERMINED`, but `expected.json`, `report.json` and lifecycle behavior record `COMPLETED`. | Corrected in the current README and manifest. The case is `NON_COMPLIANT` and `COMPLETED`: execution completed, but outside both authorization windows. No computed output changed. |
| G8 | `authorizationCode` and `receiptClaimsValid` are not defined for this matrix, and no receipt object is published. | Left undefined and non-comparable. The reader correctly did not treat these outputs as independently verified claims. |

## Hash and signature rule source used by the independent reader

The reader reports that it used
[`aps-priorseal-signing-bytes-v0.4.0.md`](../../architecture/aps-priorseal-signing-bytes-v0.4.0.md)
to reproduce these relationships, although that page was written for another
fixture. In that rule set, `C(x)` is UTF-8 JSON with no whitespace, object keys
recursively sorted in JavaScript string-sort order, array order preserved, and
keys and primitive values serialized with `JSON.stringify`; undefined values,
non-finite numbers and unsafe keys are rejected. `H(x)` is lowercase hex
SHA-256 of UTF-8 `C(x)` (64 hex characters, no `0x` prefix):

- `intentHash = H(intent without intentHash)`.
- `authorizationId = "auth_" + first 32 hex characters of H(authorization without authorizationId and signature)`.
- `authorizationHash = H(full authorization, including its identifier and signature)`.
- `entryHash = H({sequence, authorizationHash, acceptedAt, previousEntryHash})`.
- The acceptance signature verifies over canonical UTF-8 JSON of the acceptance with only its top-level `signature` removed.

Those formulas explain the independent reader's successful recomputation. Their
presence in a separate architecture note does not make them part of the frozen
v1.0.1 matrix contract.

## Exact reported outcomes

| Case | Binding | Compliance | Outcome |
| --- | --- | --- | --- |
| 00 | bound | `COMPLIANT` | `COMPLETED` |
| 01–03 | mismatch | `NON_COMPLIANT` | `COMPLETED` |
| 04 | bound under v1.0.1 partition; evidence unavailable | `NOT_ASSESSABLE` | `UNDETERMINED` |
| 05 | outside both time windows | `NON_COMPLIANT` | `COMPLETED` |

Case 04 retains the producer's raw binding (`bound: false` with
`EXECUTION_UNAVAILABLE`) separately from the v1.0.1 partition (`bound: true`
plus an availability code).

## Scope

This is a synthetic, offline, answer-exposed interoperability record. It
supports repeatability and agreement on the comparable fields for the pinned
artifact. It does not establish real-chain observation or finality, production
key custody, economic safety, policy admission, a security audit, adoption,
integration, pilot participation or endorsement.
