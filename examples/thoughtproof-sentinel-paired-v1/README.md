# ThoughtProof Sentinel M1 + PriorSeal paired vectors

This fixture pairs ThoughtProof's delivered M1 signed canonical exports with independently signed PriorSeal v3 exact-call receipts. It demonstrates that a PriorSeal authorization can commit to the exact transported Sentinel artifact digest without importing Sentinel verdict semantics into PriorSeal or turning Sentinel into a wallet authorization layer.

## Status and scope

- The ThoughtProof production half is the real `export-prod-live.json` delivered on 2026-09-13, signed by the active production kid `tp-sentinel-export-ed25519-2026-09`.
- The matching PriorSeal receipt is synthetic and signed only by the fixture identity `priorseal.thoughtproof-fixture`. It does not represent a live transaction, production deployment, or either party's endorsement of the other's conclusions.
- The repeatable fixture half uses ThoughtProof's `tp-sentinel-export-ed25519-2026-09-vector` kid and is accepted only when the case explicitly enables vector-only verification.
- M1 binds the exact signed decision artifact through `thoughtproof.sentinel-decision.v1`. The current Sentinel canonical body does not sign an exact-call decision subject, so every passing pair honestly reports `DECISION_SUBJECT_UNBOUND` until M2.
- Oracle Watch is outside this composition. M2 remains the separate built-transaction pre-sign path.

## Pinned contracts

- ThoughtProof export schema: `thoughtproof.sentinel.export.v1`
- ThoughtProof artifact schema: `sentinel.verdict.canonical.v1`
- Signature input: `UTF-8("thoughtproof.sentinel.export.v1") || 0x00 || JCS(signed envelope fields)`
- Envelope algorithm: `Ed25519`
- Key-document algorithm label: `EdDSA`
- Commitment namespace: `thoughtproof.sentinel-decision.v1`
- Commitment algorithm: `sha256`
- Commitment input: the UTF-8 bytes of the exact transported `canonical` string
- PriorSeal receipt: `priorseal.execution-receipt.v3`
- PriorSeal intent: `priorseal.intent.v2` with `priorseal.execution-profile.exact-call.v1`

`expected.json` pins both ThoughtProof public-key `x` values and the SHA-256 fingerprint of the PriorSeal fixture issuer SPKI. The included `thoughtproof-keys.json` is therefore discovery material, not a self-authorizing trust root.

## Verification order

1. Require a signed export and resolve its `keyId` against the out-of-band pin and bundled ThoughtProof key document.
2. Enforce production versus vector-only key separation. A vector kid is rejected unless that case explicitly opts in.
3. Check the key's `notBefore` / `notAfter` window against the export's `signedAt`; a retired key remains valid for an artifact signed inside its historical window.
4. Verify the ThoughtProof Ed25519 signature over the domain-separated signed input.
5. Recompute SHA-256 directly over the transported canonical string. Never parse and re-canonicalize it, and never substitute a fresh `/sentinel/verify` result.
6. Independently verify the PriorSeal issuer acceptance, EIP-712 authorization, exact-call binding, v3 receipt signature, confirmed execution status, and compliance result.
7. Require exactly one `thoughtproof.sentinel-decision.v1` / `sha256` commitment matching the authenticated ThoughtProof digest.
8. If the export carries `validUntil`, require the PriorSeal authorization to end no later than that signed decision-expiry boundary.
9. Map `ALLOW → RECOMMEND`, `BLOCK → DO_NOT_RECOMMEND`, and `UNCERTAIN → REVIEW_REQUIRED` without treating that effect as transaction authority.
10. Report `DECISION_SUBJECT_UNBOUND` because exact-call subject binding belongs to M2.

## Included cases

The verifier executes 13 cases:

1. Real ThoughtProof production export + matching synthetic PriorSeal receipt → `DECISION_COMMITMENT_VERIFIED` and `DECISION_SUBJECT_UNBOUND`.
2. ThoughtProof vector export + matching synthetic PriorSeal receipt with explicit vector allowance → same result.
3. Vector kid without explicit allowance → `DECISION_SIGNER_UNTRUSTED`.
4. Missing signed export → `DECISION_EXPORT_MISSING`.
5. Tampered transported canonical string → `DECISION_SIGNATURE_INVALID`.
6. Tampered signed `validUntil` → `DECISION_SIGNATURE_INVALID`.
7. Known kid with a signature from the wrong key → `DECISION_SIGNATURE_INVALID`.
8. Unknown ThoughtProof kid → `DECISION_SIGNER_UNTRUSTED`.
9. Valid PriorSeal receipt with the wrong digest → `CONTEXT_COMMITMENT_DIGEST_MISMATCH`.
10. Missing ThoughtProof namespace → `CONTEXT_COMMITMENT_MISSING`.
11. More than one commitment in the ThoughtProof namespace → `CONTEXT_COMMITMENT_AMBIGUOUS`.
12. PriorSeal authorization outliving signed decision expiry → `DECISION_EXPIRES_BEFORE_AUTHORIZATION`.
13. Tampered PriorSeal receipt signature → `PRIORSEAL_INVALID_SIGNATURE`.

## Run

From the PriorSeal repository:

```sh
npm run example:thoughtproof-paired
```

The sendable archive contains a bundled zero-install verifier instead:

```sh
node verify-paired-vectors.mjs
```

All checked-in receipts are immutable synthetic vectors. The public verification keys are included; the PriorSeal fixture signing keys are not included in the sendable archive and must never be treated as production identities.

The delivered production export's signed freshness window ends at `2026-09-13T16:47:55Z`. This fixture evaluates its historical authorization against that signed window. Expiry does not invalidate the artifact's historical signature, and a fresh Sentinel verification must not be used to replace it.
