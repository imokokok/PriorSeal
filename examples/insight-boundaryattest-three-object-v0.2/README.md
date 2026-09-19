# Insight–BoundaryAttest–PriorSeal three-object synthetic fixture

This fixture implements the synthetic stage accepted in [PriorSeal Issue #4](https://github.com/imokokok/PriorSeal/issues/4#issuecomment-5707403316). It tests whether a BoundaryAttest object contributes a distinct governance handoff between Insight's signed pre-execution risk evidence and PriorSeal's signed principal authorization and observed execution evidence.

The result is deliberately falsifiable. A technically valid three-object composition is not enough. The final deletion test asks which materially relevant fact becomes unverifiable if BoundaryAttest is removed. If no such fact exists, the result must be `BOUNDARYATTEST_REFERENCE_ONLY`.

The fixture records that semantic assessment explicitly in `expected.json`. The verifier rejects a missing or malformed assessment and can return either `BOUNDARYATTEST_ADDS_GOVERNANCE_HANDOFF` or `BOUNDARYATTEST_REFERENCE_ONLY`; the unit test exercises both outcomes. This explicit record is necessary because cryptographic verification alone cannot decide whether an independently signed fact is operationally material or already supplied by another native evidence object.

## Pinned sources and trust roots

- PriorSeal base commit: `9260a115c42358046a6af7af0c86489ec0ec252b`
- Insight source commit: [`a5fe98018dc87936aad1647c8f631f1d661b0ebf`](https://github.com/imokokok/Insight/commit/a5fe98018dc87936aad1647c8f631f1d661b0ebf)
- BoundaryAttest source commit: [`fc2fb18af50458c0a6fd2489768e21fd339a621e`](https://github.com/cullenmeyers/BoundaryAttest/commit/fc2fb18af50458c0a6fd2489768e21fd339a621e)
- Insight trust root: the fixture pins the expected EIP-712 attester address independently in `expected.json`.
- BoundaryAttest trust root: `boundaryattest-public-key.pem` is supplied independently from the strict receipt envelope; its SPKI fingerprint must equal `public_key_id`.
- PriorSeal trust root: `priorseal-trusted-issuer-keys.json` pins the fixture issuer and Ed25519 public key independently from the receipt.

All identities are deterministic, synthetic and non-production. The generator contains fixture-only private values so the complete vector set can be reproduced; those values must never be reused outside tests.

## Three independently verified objects

### 1. Insight risk evidence

`insight-source.json` and `insight-destination.json` are Oracle Safety Check v3 EIP-712 attestations. The verifier uses the v3 domain and 27-field type directly rather than trusting transported EIP-712 metadata. For each attestation it:

1. checks schema v3 and the independently pinned attester;
2. recomputes the EIP-712 UID;
3. verifies the EOA signature;
4. recomputes the canonical pre-trade `requestHash`;
5. requires a signed `PASS` verdict and satisfied signed quorum/independence thresholds; and
6. evaluates the signed `checkedAt` / `validUntil` window at PriorSeal authorization time.

The composition then recomputes the existing Insight commitment exactly as implemented by `buildInsightPriorSealContextCommitment()`:

```text
keccak256(abi.encode(
  sourceUid,
  destinationUid,
  sourceRequestHash,
  destinationRequestHash,
  uint16(maxSlippageBps)
))
```

Its namespace is `insight.pretrade-pair.v1`.

### 2. BoundaryAttest governance handoff

The strict v0.2 envelope contains only `claim`, `signature` and `public_key_id`. The Ed25519 signature covers `RFC8785-JCS(claim)`. The accepted core event semantics are fixed as:

```json
{
  "receipt_role": "server_attested",
  "action_type": "governance.decision_evidence_exported",
  "status": "exported"
}
```

The underlying result lives in `decision_record.resolution` and uses the narrow verdicts `proceed_to_principal_authorization` or `stop_before_principal_authorization`, never generic transaction-like `allow` / `deny` terminology.

`decision_record.subject.action_ref` is the preselected PriorSeal `intentId`. `opened.scope` signs the exact `chainId`, executor, transaction nonce, call target, calldata hash and native value. `evidence.source_ref` identifies the exact `insight.pretrade-pair.v1` commitment.

The PriorSeal intent binds two independent BoundaryAttest references:

- `boundaryattest.insight-handoff.jcs-claim.v0.2` → `SHA-256(RFC8785-JCS(claim))`
- `boundaryattest.governance-signer.spki-sha256.v1` → the expected governance key's SPKI SHA-256 fingerprint

The second commitment prevents the same claim bytes from retaining the same claim digest after being re-signed by an unapproved governance key. This remains composition policy, not a BoundaryAttest v0.2 change.

### 3. PriorSeal authorization and execution evidence

The fixture uses `priorseal.intent.v2` with `priorseal.execution-profile.exact-call.v1`. PriorSeal independently verifies the EIP-712 principal authorization, issuer acceptance, Ed25519 receipt signature, exact-call execution binding, compliance, execution time and finality. It does not reinterpret Insight's risk conclusion or assert the truth of the BoundaryAttest governance claim.

The intent's `validUntil` must not exceed the earliest Insight attestation expiry or the BoundaryAttest decision timestamp plus the fixture's 300-second decision window.

## Freshness, replay and state mutation

- Insight validity uses each signed `checkedAt` and `validUntil` at authorization time.
- BoundaryAttest export freshness uses `claim.timestamp`.
- BoundaryAttest decision freshness uses `decision_record.resolution.timestamp`.
- Both BoundaryAttest ages are limited to 300 seconds with 30 seconds of future skew for this fixture only.
- Exact export replay identity is `(public_key_id, event_id)`.
- The action-specific governance `decision_id` is consumed once.
- Replay state mutates only after every signature, commitment, correlation, scope, freshness, authorization and execution check passes.

## Included vectors

The executable set contains 23 cases:

- one fully matching flow;
- tampered, wrong-key and expired Insight evidence;
- changed Insight pair commitment;
- tampered, wrong-key, generic-verdict and wrong-core-status BoundaryAttest claims;
- a valid stop verdict that must block the otherwise executed flow;
- stale export and stale underlying decision as separate cases;
- exact-export replay and decision replay as separate cases;
- mismatched `decision_record.subject.action_ref`;
- changed calldata hash and changed call target as separate exact-call cases;
- changed Insight evidence reference inside BoundaryAttest;
- changed and missing BoundaryAttest claim commitments;
- changed separately bound BoundaryAttest signer identity;
- non-compliant observed execution; and
- a PriorSeal validity window that exceeds the evidence window.

The unit test additionally proves that a failed flow does not consume export or decision replay state.

## Deletion-test conclusion

The matching fixture returns `BOUNDARYATTEST_ADDS_GOVERNANCE_HANDOFF` because removing the BoundaryAttest object makes this exact fact unverifiable:

> The independently pinned governance signer reviewed the exact named Insight evidence for the exact proposed EVM call and resolved that it may proceed to principal authorization.

Insight alone proves its native risk assessment. PriorSeal alone proves principal authorization and observed execution and carries opaque commitments. Neither native object contains the independently signed governance review and handoff result. The positive value conclusion is therefore about that narrow fact only.

The recorded provider reason is to support this portable claim because it preserves that independently signed review-and-handoff fact across the system boundary. If a deployment already preserves the same material fact in native evidence, the configured deletion result must be false and the verifier returns `BOUNDARYATTEST_REFERENCE_ONLY` instead.

## Run and reproduce

Run the checked-in immutable vectors:

```sh
npm run example:insight-boundaryattest-three-object
```

Regenerate every signed synthetic artifact deterministically, then rerun:

```sh
npm run generate:insight-boundaryattest-three-object
npm run example:insight-boundaryattest-three-object
```

The expected output and verification record are in [`TEST-RECORD.md`](./TEST-RECORD.md).

## Limits

A passing result proves only that each object verifies under its independently supplied fixture trust root and that the explicit composition rules pass. It does not prove risk truth, governance correctness, economic safety, source completeness, production key custody, runtime integrity, transaction authority for Insight or BoundaryAttest, a production integration, adoption, endorsement, partnership, commercial agreement or shared standard.
