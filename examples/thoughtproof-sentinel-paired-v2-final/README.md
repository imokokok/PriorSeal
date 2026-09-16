# ThoughtProof Sentinel + PriorSeal M2 final pairs

This package regenerates the final PriorSeal pairs against the two M2 artifacts issued by ThoughtProof on 2026-09-16.

## Inputs and trust boundary

- source archive SHA-256: `e18d84a540efc3d5fc4989942393545dd0825282607599cbcf0144310bcd3810`
- ThoughtProof kid: `tp-sentinel-export-ed25519-2026-09-vector`
- key status: `vector-only`
- matching export digest: `0xa5bbfe64ca3864d7cf6d5ba0f5af1992b55d15100e0d716bd9e426b5812877a9`
- missing-subject export digest: `0x9a0476c3411cfdc40b59aad4e5c6ec656c662ca082e9e1ad2e28520e159de28a`

The ThoughtProof kid is explicitly pinned for these vectors and must be rejected unless vector-only keys are allowed. It is not a production trust root. The PriorSeal issuer in this package is also a deterministic fixture issuer, not a production issuer.

M1 remains unchanged: `sentinel.verdict.canonical.v1`, `thoughtproof.sentinel.export.v1`, `thoughtproof.sentinel-decision.v1`, and SHA-256 over the exact transported canonical string.

## Final pairs and expected results

| Pair/check | Expected result |
|---|---|
| ThoughtProof matching export + matching PriorSeal exact-call receipt | `DECISION_COMMITMENT_VERIFIED` + `DECISION_SUBJECT_VERIFIED` |
| ThoughtProof missing-subject export + PriorSeal receipt committing to that artifact | `DECISION_SUBJECT_MISSING` |
| Matching pair without vector-only allowance | `DECISION_SIGNER_UNTRUSTED` |

The verifier also independently derives both calldata hashes, including the normative empty-calldata value:

```text
keccak256(0x) = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
```

The full result is 5/5 checks: two calldata derivations and three receiver cases.

## Run in the repository

```sh
npm run example:thoughtproof-m2-final
```

## Run the sendable package

The archive contains a bundled verifier that needs only Node.js 18 or later:

```sh
node verify-paired-vectors.mjs
```

Verify file integrity from the archive root with:

```sh
shasum -a 256 -c MANIFEST.sha256
```

`receiver-reference.mjs` contains the readable M2 receiver core and `final-pair-reference.mjs` contains the final-pair runner. `verify-paired-vectors.mjs` is their dependency-bundled portable form.

This package is a final bilateral vector candidate, not production activation or production trust. Oracle Watch remains outside the composition. GOAT composition still requires a separate explicit go.
