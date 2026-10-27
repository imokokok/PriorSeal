# x402 Credit-pack production launch record — 2026-10-27

Status: production version deployed and validated without a payment.

## Released capability

- `Verified Action` is discoverable as a 12-Credit ($0.12) composite of
  authorization acceptance and execution observation. It is catalogue metadata,
  not a one-shot x402 purchase and not transaction authority.
- `GET /v1/agent-credit-packs/standard-100/checkout` is the only Credit-pack
  checkout: 100 prepaid PriorSeal Agent Credits for $1.00, bound to an existing
  authenticated Agent account.
- The state-changing `POST` routes remain on the reserve/consume/release
  Credit meter. A successful action includes its first portable evidence bundle;
  an independent later export remains a separately priced read-only resource.

## Prerequisites and deploy

- Production D1 migration `0010_x402_credit_purchases.sql` was applied and
  the `x402_credit_purchases` table was confirmed before deployment.
- The merged main release was `0d2d0e4fb0cb5be87ff952a7890331f4d3946ca0`.
- Cloudflare Worker version
  `ed8f67b5-4bf3-4a5a-8d84-62aafb4e4f95` was deployed with existing secrets
  preserved.

## Zero-payment verification

`GET /v1/capabilities` returned HTTP 200 and exposed `verified_action`, the
`standard-100` pack, and all three paid GET routes. Unauthenticated GETs to the
receipt bundle probe, integration-readiness probe, and the Credit-pack checkout
each returned HTTP 402 with a `PAYMENT-REQUIRED` header. No request carried a
`PAYMENT-SIGNATURE`; `/verify` and `/settle` were not called.

The live facilitator advertised nine exact-v2 rails at validation time:
Base, Arbitrum, Polygon, Avalanche, Sei, X Layer, Monad, BNB Smart Chain, and
Solana mainnet. Ethereum and OP Mainnet were configured candidates but were
not advertised, so the production allowlist is narrowed to the nine live
rails. This makes the checked-in release configuration match the actual
customer quotes; it adds no rail and changes no advertised price or payee.

No production payment or subject-chain transaction was signed, broadcast, or
settled in this launch validation. A paid mainnet rehearsal remains separately
capped and requires a new explicit authorization under the production Go/No-Go
runbook.
