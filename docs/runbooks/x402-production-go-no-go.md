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
PRIORSEAL_X402_FACILITATOR_URL=https://x402.org/facilitator
PRIORSEAL_X402_RESOURCE_ORIGIN=https://priorseal.xyz
PRIORSEAL_X402_PAY_TO=0x...reviewed-mainnet-payee...
PRIORSEAL_X402_NETWORKS=eip155:8453
PRIORSEAL_X402_TIMEOUT_MS=15000
PRIORSEAL_X402_ROUTES_JSON=[{"method":"GET","path":"/v1/receipts/:receiptId/bundle","description":"Export a portable PriorSeal receipt bundle","price":"$0.02"}]
```

Store any facilitator credentials only in
`PRIORSEAL_X402_FACILITATOR_HEADERS_JSON` as a Worker secret. Never set
`PRIORSEAL_X402_ENABLE_TESTNETS=true` in production.

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

## 4. Production payment gate and rollback

The no-payment result is not approval to settle. For one paid production
rehearsal, obtain a new explicit GO that identifies the wallet, exact route,
network, maximum amount, and incident owner. Preserve the facilitator result,
the signed bundle evidence, terminal `DELIVERED` ledger entry, and independent
on-chain reconciliation.

If the readiness check fails, remove or correct the newly added production
x402 configuration and redeploy the last known-good Worker version. Do not
retry a buyer payment automatically; reconcile a `SETTLEMENT_UNKNOWN` state
with the facilitator and chain first.
