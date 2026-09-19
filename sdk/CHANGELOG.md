# Changelog

## 0.5.0 — 2026-09-19

- Add deployment capabilities and resumable wallet-authorization checkpoints with stable idempotency keys.
- Rebuild EIP-712 signing data locally and verify request, authorization, typed-data, and signer consistency before acceptance. Export `authorizationSigningData` from `priorseal-sdk/verifier` for explicit pre-sign review.
- Permit an expired signed checkpoint to replay acceptance for historical recovery, while explicitly marking it unsuitable for execution.
- Add portable review manifests with original Insight source, destination, and execution attachments. Verify each signature and trust source, both proof UIDs, transaction chain/hash/sender/time, and the exact-call context commitment.
- Keep incomplete external checks, missing artifacts, untrusted signers, and sample trust from producing a fully verified result.
- Load signing verification lazily and ship the verifier's complete declaration dependencies for isolated TypeScript consumers.

Existing evidence formats remain unchanged. Consumers that previously passed inconsistent checkpoints or server-supplied signing layouts now receive an error before wallet signing or acceptance.
