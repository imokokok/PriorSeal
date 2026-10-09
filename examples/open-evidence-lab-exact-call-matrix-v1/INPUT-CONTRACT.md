# Input contract — exact-call envelope matrix v1

This file is the published interface for the matrix. Anything a third party
needs in order to reproduce the comparison without reading PriorSeal source is
written here.

## 1. Signed profile

`priorseal.execution-profile.exact-call.v1`, carried by a `priorseal.intent.v2`
intent inside a `priorseal.authorization.v2` authorization.

The profile binds the transaction envelope and nothing else. It deliberately
does not infer recipient, asset, amount or transfer uniqueness from emitted
`Transfer` logs, so the comparison below does not look at those fields either.

## 2. Source record

`fixture/signed-authorization.json` — schema `oel.source-record.v1`.

| Field | Meaning |
| --- | --- |
| `authorization` | The principal-signed authorization. `authorization.intent` carries the signed `callTarget`, `calldataHash` and `transactionValue`; `authorization.signature` is the EIP-712 signature over it. |
| `acceptance` | The issuer's `priorseal.authorization-receipt.v1` acceptance, Ed25519-signed. |

### 2.1 EIP-712 authorization digest and recovery rule

Domain: `{ name: "PriorSeal", version: "2", chainId: intent.chainId }`
Primary type: `PriorSealAuthorization`

| Field | Solidity type |
| --- | --- |
| `intentHash` | `bytes32` |
| `principalType` | `string` |
| `principalId` | `string` |
| `principalAccount` | `address` |
| `authorizerType` | `string` |
| `authorizer` | `address` |
| `agentId` | `string` |
| `executor` | `address` |
| `issuedAt` | `uint256` |
| `notBefore` | `uint256` |
| `expiresAt` | `uint256` |
| `authorizationNonce` | `bytes32` |
| `maxUses` | `uint256` |
| `audience` | `string` |
| `policyHash` | `bytes32` |

Notes that matter for byte agreement:

- `authorization.intent.intentHash` is stored as **bare lowercase hex** (no `0x`).
  The struct field is the `0x`-prefixed 32-byte form. The other three `bytes32`
  fields are already `0x`-prefixed in the signed authorization.
- `issuedAt`, `notBefore`, `expiresAt` and `maxUses` are decimal strings in the
  JSON object and `uint256` in the digest input.
- Recovery rule: `digest = hashTypedData(domain, types, message)`, then recover
  the signer from `(digest, authorization.signature)` and require equality with
  `authorization.authorizer.address`.

A reader that reproduces the digest and recovers
`0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A` has the same signing bytes as the
producer. `report.json` records the digest this fixture yields.

### 2.2 Acceptance signature rule

`signature = base64url(Ed25519.sign(seed, utf8(canonicalJson(acceptance without "signature"))))`

The verification key is published in `fixture/public-test-keys.json`. The
canonical JSON is the producer's RFC 8785-style canonical form; it is the
producer's rule and is named here so the check is reproducible, not because the
reader has to re-derive it.

## 3. Observed envelopes

`fixture/observed/<case-id>.json` — each file is one `priorseal.execution-observation.v1`
envelope in the producer's normalized form. Only these fields take part in the
comparison.

## 4. Field map

| Signed (`authorization.intent`) | Observed (`execution-observation.v1`) | Rule | Reason code |
| --- | --- | --- | --- |
| `chainId` | `chainId` | strict equality | `CHAIN_MISMATCH` |
| `action` | `action` | case-insensitive equality | `ACTION_MISMATCH` |
| `sender` | `sender` | case-insensitive equality | `SENDER_MISMATCH` |
| `nonce` | `nonce` | strict string equality, default `"0"` | `NONCE_MISMATCH` |
| `callTarget` | `target` | case-insensitive equality, only when present in the signed intent | `CALL_TARGET_MISMATCH` |
| `calldataHash` | `calldataHash` | case-insensitive equality, only when present in the signed intent | `CALLDATA_MISMATCH` |
| `transactionValue` | `nativeValue` | strict string equality, only when present in the signed intent | `TRANSACTION_VALUE_MISMATCH` |
| `validUntil` | `executedAt` (fallback `observedAt`) | observed time greater than `validUntil` | `OUTSIDE_TIME_WINDOW` |

Result: `bound = reasonCodes is empty`. Reason codes are compared as a
**sorted set**, so implementation order does not matter.

## 5. Evidence availability

| Observed | Rule | Code |
| --- | --- | --- |
| `executionDataAvailable` | `false` yields `EXECUTION_UNAVAILABLE` | `EXECUTION_UNAVAILABLE` |

This is a separate class. It says the evidence is missing, not that the
authorization was breached, and it is never scored as a mismatch.

## 6. Deliberately not compared

| Field | Why |
| --- | --- |
| `intent.recipient` | exact-call binds the transaction envelope; it does not infer transfer semantics |
| `intent.asset` | same |
| `intent.amount` | same |
| `execution.transfers` | transfer uniqueness is not a property of an exact-call envelope |

## 7. What the result means

| Case | Reader / profile | Meaning |
| --- | --- | --- |
| `case-00` | `bound: true`, no reason codes | The observed envelope is the authorized envelope |
| `case-01` | `CALL_TARGET_MISMATCH` | The observed call went to a different target |
| `case-02` | `CALLDATA_MISMATCH` | The observed calldata hash differs from the signed one |
| `case-03` | `TRANSACTION_VALUE_MISMATCH` | The observed native value differs from the signed one |
| `case-04` | `EXECUTION_UNAVAILABLE` | The evidence is missing; no agreement claim is made |

A mismatch result is a statement about the envelope relation only. It does not
establish that the calldata was malicious, that an economic loss occurred, or
that anything happened on a real chain.

## 8. Attribution

The binding rules, reason codes and the `COMPLIANT` / `NON_COMPLIANT` /
`NOT_ASSESSABLE` vocabulary belong to the PriorSeal exact-call profile.
`reader.mjs` is the Open Evidence Lab reader: a separate implementation of
section 4 and section 5 that imports nothing from PriorSeal. A passing run shows
that the two agree on these inputs. It is not a statement about either project
by the other, and it is not an endorsement, integration or pilot.
