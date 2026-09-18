# APS decision evidence × PriorSeal exact-call authorization

Status: pre-implementation claim-boundary design. The direction was accepted by the APS maintainer in [agent-passport-system issue #163](https://github.com/aeoess/agent-passport-system/issues/163#issuecomment-5732627215). The runnable example remains blocked on the committed APS inputs that the maintainer agreed to produce.

This design describes a sibling adapter, not an `execution-envelope.v0.1` example and not an extension of either project's core protocol. The adapter correlates an independently signed APS decision with a principal-signed PriorSeal exact-call authorization across two trust domains. APS and PriorSeal artifacts, signatures, verification keys, verdicts, and trust roots remain separate.

## Pinned public boundary

| Item | Contract |
|---|---|
| APS dependency | Exact `agent-passport-system@6.0.1`, imported only from the package root |
| APS verification | `verifyReceiptWithDecisionV1(receipt, decisionEvidence, resolveKey)` must return `valid === true` |
| PriorSeal dependency | Exact released `priorseal-sdk@0.4.0` for the initial example |
| Commitment | Exactly one `aps.decision-ref.v1` / `sha256` context commitment |
| Digest representation | `0x` followed by the unchanged lowercase `ReceiptV1.decision_ref`; no re-hash |
| Placement | `examples/aps-priorseal-decision-binding-v1/` after the APS inputs arrive |
| Runtime | Deterministic, offline, Node.js 22+, with no external service |

The adapter must not construct `aps-decision-ref-v1`, deep-import its builder, or regenerate APS decision artifacts. The decision-ref builder is not part of the APS 6.0.1 public export surface. The APS maintainer owns the committed `permit`, `narrow`, `deny`, and `expired` inputs, each with `DecisionEvidenceV1`, a signed `ReceiptV1`, and the independently pinned verifying key. PriorSeal consumes those bytes without silently replacing or normalizing the producer artifacts.

## Verification and authorization flow

1. Load one committed APS receipt, its decision evidence, and the separately pinned APS verification key.
2. Call the APS package-root `verifyReceiptWithDecisionV1` API. Reject unless `valid === true`, `decision_ref_present === true`, `decision_ref_bound === true`, and `temporal_relation_valid === true`.
3. Apply the adapter decision gate. A `permit` may continue. A `narrow` may continue only when every constraint used by the fixture has an explicit deterministic mapping to an exact-call predicate and every predicate passes. Unknown or unmapped constraints fail closed. A `deny` never reaches PriorSeal authorization.
4. At the verifier-supplied fixed reference time, require the APS decision to be unexpired. Separately require the PriorSeal intent's `validUntil` not to exceed the APS decision's `valid_until`. The APS composite verifier proves only that `valid_until` is after the receipt's `issued_at`; it does not establish freshness at authorization or chain execution and does not recheck revocation. Any claim about revocation is limited to separately verified state supplied with the fixture and never implies live freshness.
5. Build one `priorseal.intent.v2` exact-call intent carrying `{ namespace: "aps.decision-ref.v1", algorithm: "sha256", digest: "0x<ReceiptV1.decision_ref>" }`. Require `matchUniqueContextCommitment` to pass so a missing, changed, or duplicate namespace fails closed.
6. The principal signs the PriorSeal authorization. PriorSeal then applies its own validity, authorization, exact-call observation, finality, compliance, and per-authorization use rules.
7. Verify the APS artifacts and PriorSeal authorization/receipt independently, then report the cross-system commitment match as a separate result.

The required description is: **execution correlated to the principal-signed authorization and the APS decision**. The adapter must not call the result “authorized execution.”

## Replay decision

The initial offline artifact will explicitly state that APS decision single use is **not established**. `verifyReceiptWithDecisionV1` does not consume `receipt_id`, and two independently signed PriorSeal intents can carry the same valid `decision_ref`. The example will make that reuse visible rather than inventing an in-memory success condition that would not survive concurrency or multiple processes.

PriorSeal's existing `maxUses: "1"`, authorization nonce, and observation claim still establish single use for each individual PriorSeal authorization. That is a different guarantee and must not be presented as one-time consumption of the APS decision. A deployment that requires decision-level single use may add a durable, atomic adapter registry keyed by the appropriate APS identity, but that policy is outside this offline interoperability proof.

## Claim matrix

| Claim | Result when all checks pass |
|---|---|
| APS receipt signature and receipt/decision binding verify under the pinned APS key | Established by APS 6.0.1 |
| APS decision is unexpired at the fixed offline reference time | Established by the adapter time check against committed evidence |
| PriorSeal authorization binds one exact EVM call and one APS decision ref | Established by the principal signature over the PriorSeal `intentHash` |
| Observed execution matches the signed exact-call authorization | Established or rejected by PriorSeal independently |
| The two artifacts are correlated by one unambiguous decision ref | Established by the unique context commitment check |
| APS policy semantics, economic safety, or correctness of a `narrow` constraint without a mapped predicate | Not established |
| Revocation validity not separately verified from supplied state, live revocation freshness, or chain-time APS currency | Not established |
| APS decision-level single use across multiple PriorSeal authorizations | Not established |
| A shared APS/PriorSeal trust root, verdict, endorsement, or commercial partnership | Not established |

## Required fixture cases

The producer-supplied APS cases are `permit`, `narrow`, `deny`, and `expired`. The completed example must also exercise:

- matching `permit` plus matching confirmed execution;
- `narrow` with mapped predicates, plus a failed predicate or an explicit fail-closed result when no mapping exists;
- `deny` and expired decisions rejected before PriorSeal authorization;
- missing, duplicate, and changed `aps.decision-ref.v1` commitments;
- a correlated execution that differs from the signed exact call, reported by PriorSeal as `NON_COMPLIANT` rather than relabeled as authorized;
- the same APS `decision_ref` carried by two different PriorSeal intents, reported with `singleUseEstablished: false`; and
- independent key failure on either trust domain.

## Acceptance gates

- The APS package is pinned exactly and only package-root exports are used.
- APS producer inputs are committed byte-for-byte with source version and producer commit metadata; the adapter contains no APS fixture generator.
- Every case runs offline and emits machine-readable per-system and composition results.
- Both trust roots are supplied independently of the artifacts they verify.
- Negative cases fail at the named boundary and do not erase otherwise valid evidence from the other system.
- No existing PriorSeal schema, APS schema, historical receipt, or OracleSafetyCheck vector is changed.
- An APS `INTEGRATION.md` reference is requested only after the runnable example and its negative cases pass.
