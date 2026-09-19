# Reproducible synthetic test record

- Recorded: 2026-09-17 (Asia/Shanghai)
- Fixture schema: `priorseal.insight-boundaryattest-three-object-fixture.v1`
- Command: `npm run example:insight-boundaryattest-three-object`
- Expected cases: 23
- Value conclusion: `BOUNDARYATTEST_ADDS_GOVERNANCE_HANDOFF`

## Expected output

```text
PASS fully matching three-object flow: OK
PASS tampered Insight source attestation: INSIGHT_SOURCE_UID_MISMATCH
PASS wrong-key Insight source attestation: INSIGHT_SOURCE_SIGNER_UNTRUSTED
PASS expired Insight source evidence: INSIGHT_SOURCE_EVIDENCE_EXPIRED
PASS changed Insight pair commitment: INSIGHT_CONTEXT_COMMITMENT_DIGEST_MISMATCH
PASS tampered BoundaryAttest claim: BOUNDARYATTEST_SIGNATURE_INVALID
PASS wrong-key BoundaryAttest claim: BOUNDARYATTEST_KEY_ID_MISMATCH
PASS invalid generic BoundaryAttest governance verdict: BOUNDARYATTEST_GOVERNANCE_VERDICT_INVALID
PASS valid BoundaryAttest stop verdict blocks the executed flow: BOUNDARYATTEST_GOVERNANCE_STOPPED
PASS invalid BoundaryAttest core status semantics: BOUNDARYATTEST_CORE_EVENT_SEMANTICS_INVALID
PASS stale BoundaryAttest export: BOUNDARYATTEST_EXPORT_STALE
PASS stale BoundaryAttest underlying decision: BOUNDARYATTEST_DECISION_STALE
PASS replayed exact BoundaryAttest export: BOUNDARYATTEST_EXPORT_REPLAYED
PASS replayed BoundaryAttest decision: BOUNDARYATTEST_DECISION_REPLAYED
PASS mismatched decision_record.subject.action_ref: BOUNDARYATTEST_SUBJECT_ACTION_REF_MISMATCH
PASS changed exact-call calldata hash: BOUNDARYATTEST_SCOPE_CALLDATA_MISMATCH
PASS changed exact-call target: BOUNDARYATTEST_SCOPE_TARGET_MISMATCH
PASS changed BoundaryAttest Insight evidence reference: BOUNDARYATTEST_INSIGHT_REFERENCE_MISMATCH
PASS changed BoundaryAttest claim commitment: BOUNDARYATTEST_CONTEXT_COMMITMENT_DIGEST_MISMATCH
PASS missing BoundaryAttest claim commitment: BOUNDARYATTEST_CONTEXT_COMMITMENT_MISSING
PASS changed separately bound BoundaryAttest signer identity: BOUNDARYATTEST_SIGNER_CONTEXT_COMMITMENT_DIGEST_MISMATCH
PASS observed execution mismatch: PRIORSEAL_RECEIPT_NOT_COMPLIANT
PASS PriorSeal validity exceeds evidence window: PRIORSEAL_VALIDITY_EXCEEDS_EVIDENCE
VALUE BOUNDARYATTEST_ADDS_GOVERNANCE_HANDOFF
DELETION TEST The independently pinned governance signer reviewed the exact named Insight evidence for the exact proposed EVM call and resolved that it may proceed to principal authorization.
PROVIDER REASON Support the portable claim because it preserves an independently signed governance review and handoff fact that neither native Insight risk evidence nor native PriorSeal authorization and execution evidence establishes.
LIMIT no signature proves another system's semantic truth; a passing composition is not economic safety, transaction authority, production readiness, adoption, or endorsement.
```

## Interpretation

The deletion test finds one material fact that Insight + PriorSeal cannot establish alone: a separately pinned governance signer reviewed the named Insight pair for the exact proposed action and released it only to the principal-authorization stage. The BoundaryAttest claim does not itself authorize or execute the transaction.

If a future workflow carries that same fact natively in independently verifiable Insight or PriorSeal evidence, the deletion test must be rerun and may require `BOUNDARYATTEST_REFERENCE_ONLY` instead.
