# Exact-call partner reference v1

A self-contained, synthetic reference for an integrator that already owns
transaction construction, wallet signing, key custody, and broadcast. It
shows how a principal-signed `priorseal.intent.v2` exact-call authorization is
accepted before a synthetic observation and then retained as a signed v3
receipt for independent local review.

This is a **reference fixture**, not a statement that any named partner has
adopted PriorSeal. No RPC endpoint, hosted PriorSeal service, funded wallet,
private credential, or real transaction is used.

## Run from a fresh checkout

Node.js 22 or later is required. The additional installation is an existing
isolated maintenance example that the repository TypeScript build checks.

```sh
npm ci
npm ci --prefix examples/aps-priorseal-decision-binding-v1 --ignore-scripts
npm run sdk:build
npm run core:build
node examples/exact-call-partner-reference-v1/generate-fixtures.mjs
node examples/exact-call-partner-reference-v1/verify.mjs
```

The final report must have `summary.result: "PASS"`. The exact-match receipt
reports `valid: true`, `code: "OK"`, `outcome: "COMPLETED"`,
`executionStatus: "CONFIRMED"`, and `complianceStatus: "COMPLIANT"`.

The verifier uses the checked-in `sdk/dist` build of the published
`priorseal-sdk@0.11.1` `verifyReceiptLocally` surface. It does not call an API
or make an RPC request. The explicit `now` value comes from each synthetic
receipt so the historical fixture is deterministic.

## What the integration owns

An integrator, not PriorSeal, constructs the intended call, asks the principal
to sign, holds keys, applies application policy, and submits the transaction.
PriorSeal binds the signed chain, executor, target, calldata hash, nonce,
native value, expiry, and the opaque context-commitment digest. It does not
interpret the business meaning of calldata or the referenced context document.

`fixture/receipts/exact-match.json` contains the accepted authorization and a
synthetic observed execution. The issuer acceptance occurs at Unix second
`1001`; the observed execution is at `1100`. These are fixture timestamps,
not an independent time proof or a claim about a real chain.

The generator uses deliberately public, deterministic **test** signing
material so reviewers can reproduce the committed artifacts. It is not a
credential, must never be funded, and must never be used in a deployment. The
portable bundle itself includes only the public issuer key.

## Matrix and fail-closed behavior

`verify.mjs` recomputes manifest hashes, validates signatures and receipt
claims, and verifies each signed synthetic observation. The four receipt
mismatch cases remain cryptographically valid evidence (`valid: true`): they
fail closed through the signed binding/compliance result rather than being
silently accepted as compliant.

| Case | Expected result |
| --- | --- |
| `exact-match` | `bound: true`, `COMPLIANT`, `COMPLETED` |
| `target-mismatch` | `CALL_TARGET_MISMATCH`, `NON_COMPLIANT` |
| `calldata-mismatch` | `CALLDATA_MISMATCH`, `NON_COMPLIANT` |
| `chain-mismatch` | `CHAIN_MISMATCH`, `NOT_ASSESSABLE` |
| `authorization-expired` | `OUTSIDE_TIME_WINDOW` + `OUTSIDE_AUTHORIZATION_WINDOW`, `NON_COMPLIANT` |
| mismatched context document | `CONTEXT_COMMITMENT_DIGEST_MISMATCH` |

The context check uses `matchUniqueContextCommitment()` after the containing
receipt has been verified. Its document is application-owned data; PriorSeal
proves only that the principal authorization contains the declared digest.

## Portable v3 verification bundle

[`verification-bundle/`](./verification-bundle/) is the small transferable
sample for offline review. It contains a synthetic authorization, v3 receipt,
public issuer-key registry, context document, tampered receipt, and a
SHA-256 manifest. The bundle does not contain a private key, credential,
personal data, or confidential transaction data.

The same command above checks every bundle component hash, verifies the valid
receipt, and checks that `receipt-tampered-signature.json` fails with
`INVALID_SIGNATURE`. The included public key is discovery material only: a
reviewer must establish trust in that issuer key independently before treating
the valid signature as evidence from a trusted issuer.

`MANIFEST.json` records the complete matrix, artifact hashes, profile and
schema versions, verifier version, context digest, and expected outcomes.
`TEST-RECORD.md` records the reproducible command and expected evidence
boundary. Regenerate fixtures only through `generate-fixtures.mts` and then
run the verifier; the checked-in `.mjs` files are generated from TypeScript by
`npm run core:build`.

## Limits

This fixture does not establish a production integration, chain finality,
economic safety, contract correctness, or the meaning and trustworthiness of
the context document. It does not send a transaction or authorize real-money
use.
