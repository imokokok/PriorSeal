# BoundaryAttest v0.2 paired context-commitment fixture

This synthetic fixture demonstrates the composition proposed in [Issue #2](https://github.com/imokokok/PriorSeal/issues/2#issuecomment-5626648780). It binds an independently verified BoundaryAttest v0.2 claim to a signed PriorSeal exact-call authorization and confirmed execution receipt without importing BoundaryAttest policy semantics into PriorSeal or granting BoundaryAttest transaction authority.

## Pinned inputs

- BoundaryAttest source commit: [`1f4ca92072589783bf7a08d8262833abcd8ddccf`](https://github.com/cullenmeyers/BoundaryAttest/commit/1f4ca92072589783bf7a08d8262833abcd8ddccf)
- External vector: `examples/decision-record-v0.2-draft/sample-receipt.json` and its independently supplied sample public key from that commit
- Commitment namespace: `boundaryattest.jcs-claim.v0.2`
- Commitment algorithm: SHA-256
- Commitment input: the UTF-8 bytes of `RFC8785-JCS(receipt.claim)`
- Combination freshness policy: the export timestamp may be at most 300 seconds old and at most 30 seconds in the future when the PriorSeal authorization is issued
- Correlation policy: `decision_record.subject.action_ref` must equal `tool-call:payments.transfer:<PriorSeal intentId>` and the subject action type must be `payments.transfer`
- Replay policy: a previously consumed BoundaryAttest `event_id` is rejected by the stateful composition layer

The namespace is fixture-specific and remains provisional until both projects agree on a shared name and commitment contract.

BoundaryAttest `receipt_version` and the commitment namespace both make the selected byte contract explicit. External-evidence freshness is separate from PriorSeal authorization expiry: the external claim must be fresh when authorization is issued, while the PriorSeal `expiresAt`/intent `validUntil` bounds when the exact call may execute. Historical verification does not make an otherwise valid old receipt fail merely because wall-clock time has advanced.

## Verification order

1. Verify the strict BoundaryAttest v0.2 envelope, independently supplied Ed25519 key fingerprint, and signature over the JCS canonical claim.
2. Verify the PriorSeal v3 receipt, issuer acceptance signature, EIP-712 authorization, exact-call binding, execution status, and compliance using an independently pinned PriorSeal issuer key.
3. Recompute `SHA-256(RFC8785-JCS(claim))` and require exactly one matching PriorSeal context commitment in the fixture namespace.
4. Check the signed external subject against the PriorSeal intent identifier and action type.
5. Evaluate external freshness at authorization time, not at later historical verification time.
6. Apply stateful replay detection to the external `event_id`.

## Included cases

- Matching pair: `OK`, with a locally complete PriorSeal result of `CONFIRMED / COMPLIANT`.
- Reusing the same external event: `EXTERNAL_EVENT_REPLAYED`.
- A separately valid PriorSeal receipt containing a different digest: `CONTEXT_COMMITMENT_DIGEST_MISMATCH`.
- A separately valid PriorSeal receipt issued too long after the external evidence: `STALE_EXTERNAL_EVIDENCE`.
- A mutated BoundaryAttest decision: `INVALID_BOUNDARYATTEST_SIGNATURE`.
- A wrong independently supplied BoundaryAttest key: `BOUNDARYATTEST_KEY_ID_MISMATCH`.

Run:

```sh
npm run example:boundaryattest-paired
```

The checked-in receipts are immutable synthetic vectors. Their required public keys are included independently, while the fixture signing keys are intentionally not distributed. Recompute the documented JCS digest and verify the existing signatures; do not treat these test identities as production trust roots.

## Trust and semantic limits

The BoundaryAttest receipt is an experimental, non-normative decision-record export. Its decision is `deny`, its adjudication is `released` because it is in shadow mode, and its own execution observation is `not_observed`. The separate PriorSeal receipt reports a confirmed, compliant exact EVM call. This is intentional: it shows that the two signed objects retain distinct meanings and that BoundaryAttest does not become the transaction authorizer.

A passing combined result proves only that both artifacts passed their respective cryptographic and structural checks, the agreed claim digest was present in the signed PriorSeal intent, the narrow correlation and freshness policy passed, and the event ID was not already consumed by the example verifier. It does not prove policy truth, source completeness, economic safety, signer-runtime integrity, production key custody, or that either project endorses the other.
