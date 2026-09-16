# ThoughtProof Sentinel + PriorSeal M2 bounded-edit proposal vectors

This fixture implements the PriorSeal receiver side of the M2 exact-call subject contract after ThoughtProof accepted its structure and requested six bounded edits. It preserves the M1 decision-artifact namespace and adds a signed `decisionSubject` to the existing `sentinel.verdict.canonical.v1` body.

## Trust status

These are executable contract-proposal vectors, not final cross-party vectors. The decision exports use a deterministic vector-only key authored by YuTao Peng so the proposed contract can be tested before ThoughtProof implements it. That key is not controlled or endorsed by ThoughtProof and must never be promoted to production trust.

Final M2 acceptance requires ThoughtProof to emit equivalent exports under its own separately pinned vector or production key. The PriorSeal fixture issuer is also synthetic and non-production.

## Proposed exact-call subject

The signed canonical decision body contains exactly one `decisionSubject` object:

```json
{
  "schema": "thoughtproof.sentinel-subject.evm-exact-call.v1",
  "kind": "EVM_EXACT_CALL",
  "chainId": 8453,
  "executor": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "callTarget": "0xcccccccccccccccccccccccccccccccccccccccc",
  "transactionNonce": "1003",
  "transactionValue": "100000000000000000",
  "calldataHash": "0x39cf794737b371f8ad484ba1c38727413ebea6d5bc4e9fb43206b119a643b076"
}
```

The whitelist is closed. Any missing field, additional field, unsupported schema, non-canonical address, non-canonical unsigned integer, or non-lowercase bytes32 value fails with `DECISION_SUBJECT_INVALID` or `DECISION_SUBJECT_MISSING`.

`chainId` is a positive JSON safe integer on both sides; strings are rejected without coercion. Contract creation (`to = null`) is outside M2.0 because the subject requires a 20-byte `callTarget`.

## Binding map

| Signed decision subject | Verified PriorSeal intent |
|---|---|
| `chainId` | `intent.chainId` |
| `executor` | `intent.sender` and, through PriorSeal verification, `authorization.delegate.executor` |
| `callTarget` | `intent.callTarget` |
| `transactionNonce` | `intent.nonce` |
| `transactionValue` | `intent.transactionValue` |
| `calldataHash` | `intent.calldataHash` |

The receiver first verifies the ThoughtProof export, then the PriorSeal authorization and receipt, then the unchanged `thoughtproof.sentinel-decision.v1` commitment and decision-expiry boundary, and finally the exact-call subject. A passing pair returns `DECISION_COMMITMENT_VERIFIED` plus `DECISION_SUBJECT_VERIFIED`.

Authorization-only fields such as principal, authorizer, authorization nonce, policy hash, maximum uses and audience are intentionally absent from the Sentinel subject. ThoughtProof does not hold wallets, authorize principals or submit transactions.

`decisionSubject.transactionNonce` and `intent.nonce` are the EVM transaction nonce. PriorSeal `authorizationNonce` is independent and provides authorization replay protection only.

`intent.amount` remains signed PriorSeal-internal descriptive context and is outside M2 subject equality. M2 value equality uses only `decisionSubject.transactionValue` and `intent.transactionValue`.

## Calldata derivation fixtures

[`calldata-fixtures.json`](./calldata-fixtures.json) carries raw calldata bytes and the expected `keccak256` result. It includes both the non-empty call used by the matching pair and the normative empty-calldata case:

```text
keccak256(0x) = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
```

## Included cases

The verifier runs 30 checks: two raw calldata/keccak derivations, one direct subject-profile regression and 27 full receiver cases. Receiver coverage includes two passing pairs (the normal match and an independently different `amount`), vector-only trust gating, both `notBefore` and `notAfter` key-window misses, missing/invalid/tampered exports, missing/extra/unknown subject fields, uppercase address and hash encodings, a leading-zero uint, zero `chainId`, string intent `chainId`, all six exact-call mismatches, wrong/ambiguous commitments, decision expiry and an unmapped advisory effect.

`PRIORSEAL_EXACT_CALL_REQUIRED` is included as a direct reference-verifier fixture. In a full pair, the ordered verifier rejects a non-exact-call or wrongly typed signed intent earlier as `PRIORSEAL_INVALID_AUTHORIZATION`, preserving the agreed fail-closed precedence.

## Run

From the PriorSeal repository:

```sh
npm run example:thoughtproof-m2
```

The sendable archive contains a bundled verifier that runs with Node.js 18 or later and no package installation:

```sh
node verify-paired-vectors.mjs
```

It also includes `receiver-reference.mjs`, the readable reference implementation used by the repository tests. That source imports the built PriorSeal SDK; the bundled verifier is the portable executable copy.

Oracle Watch is outside this composition. GOAT composition remains a separately approved step.
