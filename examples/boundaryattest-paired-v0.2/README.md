# BoundaryAttest v0.2 paired context-commitment fixture

This synthetic fixture demonstrates the composition proposed in [Issue #2](https://github.com/imokokok/PriorSeal/issues/2#issuecomment-5626648780) and incorporates the [BoundaryAttest author's fixture review](https://github.com/imokokok/PriorSeal/issues/2#issuecomment-5641294222). It binds an independently verified BoundaryAttest v0.2 claim to a signed PriorSeal exact-call authorization and confirmed execution receipt without importing BoundaryAttest policy semantics into PriorSeal or granting BoundaryAttest transaction authority.

## Pinned inputs

- BoundaryAttest source commit: [`1f4ca92072589783bf7a08d8262833abcd8ddccf`](https://github.com/cullenmeyers/BoundaryAttest/commit/1f4ca92072589783bf7a08d8262833abcd8ddccf)
- External vector: `examples/decision-record-v0.2-draft/sample-receipt.json` and its independently supplied sample public key from that commit
- Commitment namespace: `boundaryattest.jcs-claim.v0.2`
- Commitment algorithm: SHA-256
- Commitment input: the UTF-8 bytes of `RFC8785-JCS(receipt.claim)`
- Export freshness policy: `claim.timestamp`, the evidence-export event time, may be at most 300 seconds old and at most 30 seconds in the future when the PriorSeal authorization is issued
- Decision freshness policy: `decision_record.resolution.timestamp`, the underlying governance-decision time, may be at most 300 seconds old and at most 30 seconds in the future when the PriorSeal authorization is issued
- Correlation policy: `decision_record.subject.action_ref` must equal `tool-call:payments.transfer:<PriorSeal intentId>` and the subject action type must be `payments.transfer`
- Exact-export replay policy: a previously consumed `(public_key_id, event_id)` pair is rejected by the stateful composition layer
- Decision-consumption policy: `decision_id` can be checked against a separate stateful store when a domain requires one-time decision use; this fixture documents and tests that optional policy but leaves it disabled for the passing pair

The BoundaryAttest author accepted the namespace and claim-level binding for this fixture. The namespace remains explicitly provisional, fixture-specific and non-normative; this example does not create a shared standard or production integration.

BoundaryAttest `receipt_version` and the commitment namespace both make the selected byte contract explicit. External-evidence freshness is separate from PriorSeal authorization expiry: the export and underlying decision must meet this fixture's distinct age policies when authorization is issued, while the PriorSeal `expiresAt`/intent `validUntil` bounds when the exact call may execute. Historical verification does not make an otherwise valid old receipt fail merely because wall-clock time has advanced.

The two timestamps are not interchangeable. A recent `claim.timestamp` proves only that an export is recent; it does not make an old governance decision recent. The two replay policies are also distinct. `(public_key_id, event_id)` prevents reuse of one exact signed export without turning `event_id` into a BoundaryAttest-wide invariant. Optional `decision_id` consumption expresses a separate domain rule about using an underlying decision once.

## Verification order

1. Verify the strict BoundaryAttest v0.2 envelope, independently supplied Ed25519 key fingerprint, and signature over the JCS canonical claim.
2. Verify the PriorSeal v3 receipt, issuer acceptance signature, EIP-712 authorization, exact-call binding, execution status, and compliance using an independently pinned PriorSeal issuer key.
3. Recompute `SHA-256(RFC8785-JCS(claim))` and require exactly one matching PriorSeal context commitment in the fixture namespace.
4. Check the signed external subject against the PriorSeal intent identifier and action type.
5. Evaluate export age and clock skew from signed `claim.timestamp` at authorization time.
6. Separately evaluate decision freshness from signed `decision_record.resolution.timestamp` at authorization time.
7. Apply stateful exact-export replay detection to `(public_key_id, event_id)`.
8. If the domain enables one-time decision consumption, separately reject a previously consumed signed `decision_id`.

## Included cases

- Matching pair with an unrelated signer already using the same event ID: `OK`, demonstrating that exact-export replay identity is signer-scoped; the PriorSeal result is locally complete and `CONFIRMED / COMPLIANT`.
- Reusing the same `(public_key_id, event_id)` export: `EXTERNAL_EXPORT_REPLAYED`.
- A separately valid PriorSeal receipt containing a different digest: `CONTEXT_COMMITMENT_DIGEST_MISMATCH`.
- A separately valid PriorSeal receipt issued too long after the export: `STALE_EXTERNAL_EXPORT`.
- A recent export whose underlying decision exceeds a stricter decision-freshness policy: `STALE_EXTERNAL_DECISION`.
- A previously consumed `decision_id` when the optional one-time policy is enabled: `EXTERNAL_DECISION_REPLAYED`.
- A mutated BoundaryAttest decision: `INVALID_BOUNDARYATTEST_SIGNATURE`.
- A wrong independently supplied BoundaryAttest key: `BOUNDARYATTEST_KEY_ID_MISMATCH`.

Run:

```sh
npm run example:boundaryattest-paired
```

The checked-in receipts are immutable synthetic vectors. Their required public keys are included independently, while the fixture signing keys are intentionally not distributed. Recompute the documented JCS digest and verify the existing signatures; do not treat these test identities as production trust roots.

## Trust and semantic limits

The BoundaryAttest receipt is an experimental, non-normative decision-record export. Its decision is `deny`, its adjudication is `released` because it is in shadow mode, and its own execution observation is `not_observed`. The separate PriorSeal receipt reports a confirmed, compliant exact EVM call. This is intentional: it shows that the two signed objects retain distinct meanings and that BoundaryAttest does not become the transaction authorizer.

A passing combined result proves only that both artifacts passed their respective cryptographic and structural checks, the agreed claim digest was present in the signed PriorSeal intent, the narrow correlation and separate export/decision freshness policies passed, and the exact signed export was not already consumed by the example verifier. It does not prove policy truth, source completeness, economic safety, signer-runtime integrity, production key custody, or that either project endorses the other. When the optional decision-consumption policy is disabled, a passing result also does not prove that the underlying decision has never been used for another export or intent.
