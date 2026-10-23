# x402 production Go/No-Go

This package governs the production x402 rollout. It does not authorize a
payment. Production starts with one mainnet rail and one read-only route;
adding a rail is a separate approved change.

## 1. Complete the reviewed configuration record

Copy `config/x402-production-go-no-go.example.json` into the change-control
system, not into a tracked secret file. Replace every `REPLACE_` value with
the reviewed production payee, issuer public-key fingerprint, facilitator
approval record, rollback owner, and a change record that names the exact
network and price. Keep `paidSettlementAuthorized` false until a separate
operator explicitly authorizes one settlement.

The initial recommendation is Base mainnet (`eip155:8453`) only and the
read-only `GET /v1/receipts/:receiptId/bundle` route. This is a commercial
rollout decision, not a claim that the other supported payment rails are ready
for customers.

Choose the facilitator separately. A candidate is eligible only when its live
`GET /supported` response contains the exact v2 tuple `exact` +
`eip155:8453`, and its documented `POST /verify` and `POST /settle` request
and response shapes are compatible with PriorSeal's x402 v2 lifecycle. Do not
infer Base mainnet support from a similarly named testnet network, an example
URL, or a marketing claim. In particular, do not treat the public
`https://x402.org/facilitator` endpoint as a Base-mainnet default: verify the
live response before every release.

## 2. Apply production prerequisites

Before setting any `PRIORSEAL_X402_*` configuration, apply the x402 payment
ledger migration to `priorseal-production` and verify that
`x402_payment_ledger_events` exists. Ensure the production issuer private key,
public key, authorization policy, mainnet RPCs, and D1 health are already
healthy. Do not reuse the staging test payee, staging issuer key, testnet
network, or test wallet in production.

Configure the reviewed values as production Worker environment variables and
secrets. The minimum nonsecret values are:

```dotenv
PRIORSEAL_X402_FACILITATOR_URL=https://REPLACE_WITH_APPROVED_X402_V2_FACILITATOR
PRIORSEAL_X402_RESOURCE_ORIGIN=https://priorseal.xyz
PRIORSEAL_X402_PAY_TO=0x...reviewed-mainnet-payee...
PRIORSEAL_X402_NETWORKS=eip155:8453
PRIORSEAL_X402_TIMEOUT_MS=15000
PRIORSEAL_X402_ROUTES_JSON=[{"method":"GET","path":"/v1/receipts/:receiptId/bundle","description":"Export a portable PriorSeal receipt bundle","price":"$0.02"}]
```

Store any facilitator credentials only in
`PRIORSEAL_X402_FACILITATOR_HEADERS_JSON` as a Worker secret. Never set
`PRIORSEAL_X402_ENABLE_TESTNETS=true` in production.

For the CDP-hosted facilitator, use the exact public base URL and opt-in auth
mode below. Store both named values as Worker secrets using the reviewed
`wrangler versions secret` workflow; do not put them in `wrangler.jsonc`, a
tracked `.env`, a change record, or a command argument. Use an approved secret
manager or a transient operator environment for the local no-payment check.

```dotenv
PRIORSEAL_X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
PRIORSEAL_X402_FACILITATOR_AUTH_MODE=cdp
# Worker secrets: PRIORSEAL_X402_CDP_API_KEY_ID, PRIORSEAL_X402_CDP_API_KEY_SECRET
```

CDP mode creates a fresh method/path-bound JWT for `/supported`, `/verify`, and
`/settle`. It requires a CDP 64-byte Ed25519 API-key secret and must not be
combined with `PRIORSEAL_X402_FACILITATOR_HEADERS_JSON`. The CDP API credential
is distinct from the Base payee and any wallet private key.

Before deployment, record the dated `/supported` response and the approved
facilitator contract or service terms. If the facilitator needs headers, record
only the secret name and the owner; never put a credential in the change record
or this repository. A provider that exposes a proprietary merchant API rather
than compatible `/verify` and `/settle` endpoints is a separate integration,
not a drop-in value for `PRIORSEAL_X402_FACILITATOR_URL`.

## 3. Run the no-payment production x402 check

After the explicitly approved deployment, load only the production operator
environment and run:

```sh
npm run x402:production:check
```

The check makes three GET-only operations: facilitator `/supported`, deployed
`/v1/capabilities`, and an unpaid 402 request to the configured paid route.
It verifies the resource URL, route schedule, exact network set, all payment
requirement fields, and the `PAYMENT-REQUIRED` header. It never sends
`PAYMENT-SIGNATURE`, never calls facilitator `/verify` or `/settle`, and
cannot move funds.

The check must return `ready: true` before customer traffic is announced. A
missing production x402 configuration is intentionally a hard failure, not a
reason to infer a payee, choose more networks, or enable a route.

## 4. Verify Bazaar discovery separately

The production 402 probe proves that PriorSeal publishes compliant Bazaar
metadata, but it cannot itself add an entry to a facilitator catalog. A paying
client must echo `PaymentRequired.extensions.bazaar` in its payment payload.
After the first valid x402 payment, run the separate, read-only catalog check
from the approved transient CDP operator environment:

```sh
npm run x402:bazaar:check
```

It reads `/v1/capabilities` and CDP's Bazaar search endpoint, then requires
every configured and Evidence-API-derived paid route template to have the
expected service name, five search tags, public icon, HTTP input, JSON output
format, and Draft 2020-12 schema. It never sends `PAYMENT-SIGNATURE`, calls
`/verify` or `/settle`, or uses a wallet credential. A missing catalog entry
is a hard failure; wait for the facilitator's indexing window and retry rather
than reporting the service as agent-discoverable.

## 5. Production payment gate and rollback

The no-payment result is not approval to settle. For one paid production
rehearsal, obtain a new explicit GO that identifies the wallet, exact route,
network, maximum amount, and incident owner. Preserve the facilitator result,
the signed bundle evidence, terminal `DELIVERED` ledger entry, and independent
on-chain reconciliation.

If the readiness check fails, remove or correct the newly added production
x402 configuration and redeploy the last known-good Worker version. Do not
retry a buyer payment automatically; reconcile a `SETTLEMENT_UNKNOWN` state
with the facilitator and chain first.
