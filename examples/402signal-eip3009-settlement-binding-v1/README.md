# 402Signal EIP-3009 settlement-binding offline fixture v1

This nonproduction, EOA-only fixture reproduces the complete link between:

1. raw 402Signal route request, route response and seller challenge bytes;
2. the checked payment terms returned by the official 402Signal v0.7.3 guard;
3. a standard EIP-3009 `TransferWithAuthorization` signature;
4. an additional offchain buyer signature binding the route receipt digest to
   the exact payment authorization digest; and
5. synthetic canonical settlement evidence or an explicit reconciliation
   state.

It does not make network or RPC requests, install dependencies, use a wallet,
retain a private key, move funds, change production, prove API delivery or
usefulness, or claim Bankr compatibility.

## Exact run command

Use Node.js 22 or newer. From this directory, run exactly:

```sh
node verify.mjs
```

No `npm install` step is required. `verify.mjs` is a standalone bundle. A JSON
report is also available with `node verify.mjs --json`.

Expected output:

```text
PASS matching release=PAYLOAD_RELEASED settlement=SETTLED_CONFIRMED replacement=NOT_REQUIRED reason=OK
PASS changed-terms release=BLOCKED_BEFORE_RELEASE settlement=NOT_CHECKED replacement=NOT_APPLICABLE reason=PAYMENT_SIGNATURE_INVALID
PASS authorization-nonce-replay release=BLOCKED_BEFORE_RELEASE settlement=NOT_CHECKED replacement=NOT_APPLICABLE reason=AUTHORIZATION_ALREADY_USED
PASS binding-nonce-replay release=BLOCKED_BEFORE_RELEASE settlement=NOT_CHECKED replacement=NOT_APPLICABLE reason=BINDING_NONCE_ALREADY_USED
PASS timeout-reconciliation release=PAYLOAD_RELEASED settlement=SETTLEMENT_PENDING replacement=BLOCKED reason=RECONCILIATION_REQUIRED
PASS reorg-reconciliation release=PAYLOAD_RELEASED settlement=REORGED replacement=BLOCKED reason=REORG_RECONCILIATION_REQUIRED
PASS signed-recipient-mismatch release=BLOCKED_BEFORE_RELEASE settlement=NOT_CHECKED replacement=NOT_APPLICABLE reason=PAYMENT_RECIPIENT_MISMATCH
PASS signed-amount-mismatch release=BLOCKED_BEFORE_RELEASE settlement=NOT_CHECKED replacement=NOT_APPLICABLE reason=PAYMENT_AMOUNT_MISMATCH
PASS expired-route-valid-payment release=BLOCKED_BEFORE_RELEASE settlement=NOT_CHECKED replacement=NOT_APPLICABLE reason=ROUTE_EVIDENCE_EXPIRED
SUMMARY 9/9 PASS
```

## What is checked

The runner first verifies every file listed in `MANIFEST.json`. It then feeds
the three raw JSON files directly to 402Signal's official route guard with the
independently pinned public test key and the exact seller URL, method and body.
The guard verifies the v4 reveal commitment, leaf hash, Merkle inclusion,
checkpoint signature, original route request, current seller challenge,
selected payment terms and route expiry.

After the route gate passes, the runner independently:

- recomputes and verifies the EIP-712 EIP-3009 payment digest and EOA signature;
- recomputes and verifies the additional EIP-712 binding digest and EOA
  signature against the same buyer;
- checks the binding's route digest, payment digest, authorization nonce,
  one-time binding nonce, audience and validity window;
- compares chain, token, recipient and amount against the guard's checked
  offer before releasing the synthetic payment payload; and
- for the matching case, decodes the exact `transferWithAuthorization` call,
  checks its signature fields, `AuthorizationUsed` and `Transfer` logs,
  authorization state, canonical block identity and confirmation floor.

Timeout produces `SETTLEMENT_PENDING`; reorg produces `REORGED`. Both keep a
replacement authorization blocked until reconciliation. A valid payment
signature for the wrong recipient or wrong amount is rejected before payload
release. An otherwise valid payment authorization cannot outlive expired route
evidence.

## Cases

Ross's six requested categories are represented by nine executable vectors so
both sides of each “or” boundary are explicit:

| Category | Executable vectors | Required behavior |
|---|---|---|
| Matching | `matching` | Release, then reproduce `SETTLED_CONFIRMED` |
| Changed terms | `changed-terms` | Invalidated signature blocks before release |
| Replay | `authorization-nonce-replay`, `binding-nonce-replay` | Either replay key blocks before release |
| Unknown / reorg | `timeout-reconciliation`, `reorg-reconciliation` | Replacement stays blocked during reconciliation |
| Correctly signed offer mismatch | `signed-recipient-mismatch`, `signed-amount-mismatch` | Valid signatures still block before release |
| Expired route / valid payment | `expired-route-valid-payment` | Route expiry blocks before release |

## Fixture contents and provenance

- `fixture/raw/route-request.json`, `route-response.json` and
  `seller-challenge.json` are the Base case imported from 402Signal commit
  `ca6e2f1ee806bec6621487338ba6ed3f1ac09352`, file
  `tests/fixtures/route-binding-v1.json`.
- `vendor/route-guard-v0.7.3.mjs` is a readable standalone bundle of the
  official zero-runtime-dependency guard at that commit. Its code is also
  included in the standalone `verify.mjs`.
- `fixture/generated/signed-authorizations.json` contains only public typed
  data, digests, signatures and the EOA address. Its ephemeral generation key
  was not written to disk or included in the fixture.
- `fixture/generated/settlement-evidence.json` is explicitly synthetic. It
  contains no live transaction and makes no claim about a chain observation.
- `MANIFEST.json` records the SHA-256 and byte length of every file required by
  the portable evaluation package.

The executable fixture uses the official Base route sample and therefore signs
matching Base / USDC terms. It replaces the earlier Base Sepolia anchor table,
which was illustrative but did not include enough raw route material to prove
the cross-record term match.

## Offchain binding decision

The additional binding uses an EIP-712 domain with name
`PriorSeal EIP-3009 Settlement Binding`, version `1` and chain ID `8453`. It
intentionally omits `verifyingContract`: no contract verifies this offchain
statement, and using the token address there would imply a contract role it
does not have. The signed message still commits the route receipt digest,
payment authorization digest, authorization nonce, independent binding nonce,
issue/expiry times and audience.

This fixture changes neither the fixed 402Signal direct-call v1 construction
nor PriorSeal's production interfaces.
