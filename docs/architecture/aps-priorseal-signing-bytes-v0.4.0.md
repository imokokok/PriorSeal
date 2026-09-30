# PriorSeal signing bytes for the APS offline fixture

This document describes the existing `priorseal-sdk@0.4.0` wire behavior used by the APS × PriorSeal offline example at PriorSeal commit [`d749d2691c3e6be139de4020e7b27cdafca2c428`](https://github.com/imokokok/PriorSeal/commit/d749d2691c3e6be139de4020e7b27cdafca2c428). It supplies the signing and hash inputs that were previously spread across the [example](../../examples/aps-priorseal-decision-binding-v1/README.md) and the [pinned verifier source](https://github.com/imokokok/PriorSeal/blob/d749d2691c3e6be139de4020e7b27cdafca2c428/sdk/src/verifier-core.ts). It changes no schema, signature, verifier rule, trust root, or production activation. The referenced identities and keys are synthetic test material.

## Canonical JSON and hashes

For the JSON values in this fixture, let `C(value)` be UTF-8 JSON with no whitespace: recursively sort object keys by the JavaScript string sort order, preserve array order, and serialize each key and primitive with `JSON.stringify`. Missing members stay missing; they are not replaced by `null`. Undefined, non-finite numbers, and unsafe keys (`__proto__`, `prototype`, `constructor`) are rejected. There is no extra domain prefix for `H(value) = lowercase_hex(SHA-256(UTF-8(C(value))))`. `H` is 64 hex characters without `0x`. The fixed fixture contains no keys for which JavaScript string sorting differs from RFC 8785 sorting; independent implementations should compare the resulting bytes, not assume that any library named “JCS” has identical behavior for every possible input.

| Value | Exact input |
|---|---|
| `intent.intentHash` | `H(intent without intentHash)` |
| `authorization.authorizationId` | `"auth_" + first 32 hex characters of H(authorization without authorizationId and signature)` |
| `authorizationHash` | `H(full authorization)`, including `authorizationId` and the principal signature |
| `acceptance.entryHash` | `H({sequence, authorizationHash, acceptedAt, previousEntryHash})`; `previousEntryHash` is present as JSON `null` for the first entry |
| `executionHash` | `H(full execution object)` |
| v3 `receiptId` | `"psr_" + first 32 hex characters of H({schema: "priorseal.execution-receipt.v3", authorizationHash, executionHash, issuer, keyId})` |

These hashes are over JSON values, not the original file's whitespace. A signed object must retain its exact members and values: recomputing carried hashes after an edit does not preserve its signatures.

## Principal EIP-712 authorization v2

The fixture uses `priorseal.authorization.v2` with `domain: "priorseal/authorization/v2"` and `authorizer.type: "eip712"`. The EIP-712 domain is `{ name: "PriorSeal", version: "2", chainId: Number(authorization.intent.chainId) }`; it has no `verifyingContract` or salt. The primary type is `PriorSealAuthorization`. Its fields, **in signed order**, are:

```text
intentHash: bytes32                 = 0x + authorization.intentHash
principalType: string              = authorization.principal.type
principalId: string                = authorization.principal.id
principalAccount: address          = authorization.principal.account
authorizerType: string             = authorization.authorizer.type
authorizer: address                = authorization.authorizer.address
agentId: string                    = authorization.delegate.agentId
executor: address                  = authorization.delegate.executor
issuedAt: uint256                  = authorization.issuedAt
notBefore: uint256                 = authorization.notBefore
expiresAt: uint256                 = authorization.expiresAt
authorizationNonce: bytes32        = authorization.authorizationNonce
maxUses: uint256                   = authorization.maxUses
audience: string                   = authorization.audience
policyHash: bytes32                = authorization.policyHash
```

Integer message values are encoded as EIP-712 `uint256`, regardless of whether a JSON member such as `maxUses` is serialized as a decimal string. For the fixture the domain chain ID is `31337`, `audience` is `priorseal`, `maxUses` is `1`, and the authorizer address equals `principal.account`. Recover and compare the signer against `authorizer.address`. The fixture's `principal.id` is self-asserted; an EOA signature proves account control, not a real-world identity. ERC-1271 authorizations require chain-state verification and are outside this offline EOA fixture.

## Issuer Ed25519 statements

The PriorSeal test issuer separately signs the acceptance statement (`priorseal.authorization-receipt.v1`, domain `priorseal/authorization-receipt/v1`) and the execution receipt (`priorseal.execution-receipt.v3`, domain `priorseal/execution-receipt/v3`). For each statement, remove **only** its top-level `signature` member and sign `UTF-8(C(unsigned statement))` with Ed25519. The signature is unpadded base64url of 64 bytes. There is no added signing prefix. The signed acceptance contains `entryHash` and `authorizationHash`; the signed execution receipt contains `authorizationHash`, `executionHash`, the complete nested authorization/acceptance evidence, and its outcome and compliance fields. Resolve the issuer public key from independently pinned verifier configuration, not from the artifact under test.

## Fixed positive fixture cross-check

The committed [`payment-within-limit.json`](../../examples/aps-priorseal-decision-binding-v1/priorseal-inputs/payment-within-limit.json) is the positive reference. The negative payment fixture shares the same principal-signed authorization and therefore the same intent, authorization ID, and authorization hash, but has a different signed execution receipt.

| Field | Expected value |
|---|---|
| `intentHash` | `3d842d3e603d745e76a09d9be2d64b633082ea7a0075f95ef6a5550cb3768e42` |
| `authorizationId` | `auth_a966ad431675e218d632ae0bc6d1c361` |
| `authorizationHash` | `4716e77ef9f90a3b3d9d0f9365500820d4e0e49a012c6556ddf85486e05648cb` |
| `acceptance.entryHash` | `8cffc2b8f842a7d35c82027b50a6fb23e127b055cdbc9dce7c5d63ad7bbef2b7` |
| `executionHash` | `0250cf2ecd1b7986bc34eecd3de161fbe74362efb04089977d4fab466a407d8b` |
| `receiptId` | `psr_bc4d487f04d5faf64b3d0bf027ff5644` |

An independent entry-2 check must also validate the issuer key and both Ed25519 signatures, the principal EIP-712 signature, these carried hash links, the authorization time and audience, and the receipt's other applicable claims. This page specifies signing bytes; it does not by itself claim a complete independent verification, real execution, live revocation, APS decision-level single use, or production acceptance. The [claim boundary](./aps-priorseal-claim-boundary.md) remains the composition scope.
