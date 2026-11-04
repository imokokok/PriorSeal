# Grey Ridge Signals testnet provenance worked example v1

This is a small, executable **testnet-only** review artifact for the evidence
shape discussed in `rezearcher/x402-data-api#4`:

```text
priced tool query -> x402 settlement record -> downstream authorized action
```

Run the generated verifier with Node.js 22 or newer:

```sh
node verify.mjs
```

`verify.mjs` is generated from `verify.mts` by `npm run core:build`; edit the
TypeScript source, not the generated runtime.

The verifier checks the digest chain and an ephemeral Ed25519 signature, then
also proves that a changed source quote no longer matches the downstream
records.

## What the fixture contains

`evidence.json` begins with one public, unpaid `GET /gate/swap` quote captured
from Grey Ridge Signals on 2026-10-29T19:14:03Z. It was an HTTP 402 challenge
for the Base mainnet (`eip155:8453`) exact-USDC route; the file retains the
request URL, the relevant requirement fields, and the SHA-256 of the complete
`PAYMENT-REQUIRED` header. No payment payload was generated or submitted.

Grey Ridge's public documentation and the captured quote expose Base mainnet,
not a testnet rail. To avoid turning a review example into a mainnet payment,
the second object is explicitly labelled `SYNTHETIC_TEST_VECTOR` on Base
Sepolia (`eip155:84532`). It is a model of the testnet settlement record a
testnet mirror would expose, not a claim that Grey Ridge accepted it. The final
object is an exact, unbroadcast testnet action authorization that commits to
both prior records.

## Boundaries

- No Grey Ridge endpoint was paid and no payment signature or customer data is
  included.
- The fixture does not validate Grey Ridge's market or security signal.
- No testnet transaction was broadcast, and no wallet, key, production route,
  integration, pilot, data-access, or payment authorization is created.
- `SYNTHETIC_SETTLED` is intentionally a test-vector state, not an on-chain
  settlement claim.

That makes the artifact suitable for reviewing the provenance and
incident-analysis contract without implying that a mainnet-only seller has
added a testnet product. A live end-to-end positive trace would require a
separately provided testnet quote and settlement endpoint from the seller.
