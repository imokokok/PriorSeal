# Changelog

## 0.7.0 — 2026-09-21

- Verify compact v2 Merkle transparency checkpoints and Merkle-root EVM anchors
  while retaining historical v1 hash-chain proof support. Issuers need migration
  010 and must roll out this verifier before issuing v2 checkpoints.

- Add sequenced RWA v2 semantic proofs, same-second pairing, receiver eligibility,
  signed fill checks and independent detailed verification axes; preserve v1 vectors.
- Normalize trusted-key ordering without relaxing key revocation or validity checks.
- Pin shared RWA source hashes and frozen vectors in CI. The Node application adds
  a durable authorized execution entry and observation-only recovery (see docs/rwa-hardening.md).

- Add opt-in RWA exact-call commitments and signer-entry guards, including distinct
  authorization-time and execution-time assessments.
- Add combined RWA receipt verification with out-of-band assessment and issuer pins.
- Preserve core receipt/authorization schemas and vendored Insight protocol semantics.

## 0.6.1 — 2026-09-21

- Verify compact v2 Merkle transparency checkpoints and Merkle-root EVM anchors
  while retaining historical v1 hash-chain proof support. This verifier-only
  patch does not enable new receipt issuance or include the optional RWA APIs.

## 0.6.0 — 2026-09-20

- Add exact-call coverage commitments that bind independently verified Insight source and destination report digests into the signed PriorSeal intent.
- Cap authorization expiry to the earliest coverage report expiry and revalidate both reports immediately before provider entry.
- Require caller-owned policy and signer trust pins; unsigned, stale, scope-mismatched, untrusted or insufficient coverage fails before execution.
- Keep coverage evidence optional and external to the core PriorSeal receipt so existing authorization and verification contracts remain unchanged.

## 0.5.0 — 2026-09-19

- Add deployment capabilities and resumable wallet-authorization checkpoints with stable idempotency keys.
- Rebuild EIP-712 signing data locally and verify request, authorization, typed-data, and signer consistency before acceptance. Export `authorizationSigningData` from `priorseal-sdk/verifier` for explicit pre-sign review.
- Permit an expired signed checkpoint to replay acceptance for historical recovery, while explicitly marking it unsuitable for execution.
- Add portable review manifests with original Insight source, destination, and execution attachments. Verify each signature and trust source, both proof UIDs, transaction chain/hash/sender/time, and the exact-call context commitment.
- Support production Insight C4 v5 with its frozen 45-field EIP-712 layout and signed semantic profile. Require independent registry bytes, full SHA-256 and byte length, immutable profile/release objects and consumer-policy admission for a complete combined review.
- Keep legacy C4 review relative to its exact preserved registry snapshot; missing snapshots or unmet release floors remain incomplete. Validate production key roles, revocation windows and both pre-trade timing commitments.
- Keep incomplete external checks, missing artifacts, untrusted signers, and sample trust from producing a fully verified result.
- Load signing verification lazily and ship the verifier's complete declaration dependencies for isolated TypeScript consumers.

Existing evidence formats remain unchanged. Consumers that previously passed inconsistent checkpoints or server-supplied signing layouts now receive an error before wallet signing or acceptance.
