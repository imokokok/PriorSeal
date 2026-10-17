# x402 staging and controlled rollout

This runbook turns on x402 payment rails deliberately. It validates a
facilitator and a deployed staging API without sending a payment. A production
or staging deployment must never enable every registry entry merely because
the code supports it.

## 1. Select the first rail

Choose one or two rails from the [capability matrix](../architecture/chain-capabilities.md)
and put only those CAIP-2 identifiers in `PRIORSEAL_X402_NETWORKS`. This is a
required, explicit allowlist whenever `PRIORSEAL_ENVIRONMENT` is `staging` or
`production`; startup rejects an implicit all-network configuration.

For the isolated no-charge staging deployment, begin with Base Sepolia only:

```dotenv
PRIORSEAL_X402_ENABLE_TESTNETS=true
PRIORSEAL_X402_NETWORKS=eip155:84532
PRIORSEAL_X402_PAY_TO=0x...testnet-merchant-address...
```

`PRIORSEAL_X402_ENABLE_TESTNETS=true` is accepted only in staging, test, or
development, and unlocks only the separate `eip155:84532` registry entry. An
allowlisted EVM rail requires `PRIORSEAL_X402_PAY_TO`; an allowlisted Solana
rail requires `PRIORSEAL_X402_SOLANA_PAY_TO`. The process rejects a mismatched
combination. Add a chain only after its facilitator support, merchant
recipient, pricing, operational owner, and customer support path have been
reviewed. Payment rails are independent from subject execution chains:
enabling a payment rail does not enable transaction observation on that chain.

For every allowlisted payment rail that the deployment also intends to observe
as a subject-execution chain, configure its `PRIORSEAL_RPC_*` endpoint and add
that same CAIP-2 value to the staging-only check subset. For the Base Sepolia
staging example:

```dotenv
PRIORSEAL_RPC_BASE_SEPOLIA=https://...trusted-base-sepolia-rpc...
PRIORSEAL_X402_STAGING_OBSERVATION_NETWORKS=eip155:84532
```

The subset must be unique and contained in `PRIORSEAL_X402_NETWORKS`. Its
purpose is precise: it verifies RPC identity only for payment rails also being
claimed as observation chains, without falsely requiring that every payment
rail be a subject-execution rail.

## 2. Apply storage before enabling routes

Paid delivery is recorded in the immutable `x402_payment_ledger_events` table.
For PostgreSQL, apply `migrations/012_x402_payment_ledger.sql` through the
normal migration process before activating x402. PostgreSQL production
readiness rejects an x402 deployment when the migration or table is absent.

For Cloudflare D1, new databases include the table in
`d1/migrations/0001_initial.sql`; existing databases must apply
`d1/migrations/0002_x402_payment_ledger.sql` using the deployment's approved
D1 migration procedure. Do not enable x402 until that migration is confirmed
in the target environment.

The ledger intentionally stores a hash of `PAYMENT-SIGNATURE`, not the raw
buyer payload. A paid attempt can contain these events:

| Event | Meaning |
|---|---|
| `PAYMENT_AUTHORIZED` | Facilitator verification succeeded; this write must succeed before the protected GET runs. |
| `RESOURCE_WITHHELD` | The protected route returned non-2xx, so no settlement was requested. |
| `SETTLEMENT_FAILED` | The facilitator gave a terminal unsuccessful result. |
| `SETTLEMENT_UNKNOWN` | Settlement transport/result could not be established; reconcile before retrying any buyer action. |
| `DELIVERED` | Settlement succeeded and the response was delivered. Paid receipt bundles may include the matching signed payment evidence ID. |
| `REFUND_RECORDED` | An operator has recorded a separately verified on-chain refund; this record does not initiate a refund. |

Writes after a successful settlement are logged and alerted if unavailable, but
the API does not turn a successful payment into a false delivery failure.
Treat a missing terminal event as an operations incident and reconcile with the
facilitator and the chain before contacting the buyer.

## 3. Run the no-charge staging check

Deploy the staging configuration first, including the same explicit allowlist,
facilitator configuration, public `PRIORSEAL_X402_RESOURCE_ORIGIN`, and paid
GET route configuration that will run in the API. Then build the operation and
run it with the staging secret file:

```sh
npm run core:build:operations
node --env-file=.env.staging.local scripts/x402-staging-readiness.mjs
```

The result must be a JSON object with `ready: true`. It performs only:

1. a local `facilitator /supported` quote check;
2. `GET /v1/capabilities` against the deployed resource origin; and
3. an unpaid `GET` to the first configured route, expecting HTTP 402.

When `PRIORSEAL_X402_STAGING_OBSERVATION_NETWORKS` is set, it also calls
`eth_chainId` for every selected EVM endpoint and `getGenesisHash` for every
selected Solana endpoint, rejecting an identity mismatch. These are read-only
RPC calls.

It verifies that all three advertise exactly the configured allowlist. It
sends no `PAYMENT-SIGNATURE`, never calls `/verify` or `/settle`, and cannot
move funds. The equivalent package command is `npm run x402:staging:check`
when the environment is already loaded by the calling shell.

If the check fails, leave the allowlist unchanged, investigate the specific
facilitator/API discrepancy, and rerun only after the deployment has been
corrected. Do not silently fall back to another chain or a broader allowlist.

## 4. Single small-value paid rehearsal

After the no-charge check passes, get an explicit operator GO for one
small-value staging payment. The purchaser wallet must be separately funded
and controlled; PriorSeal does not hold private keys or submit payments from
this runbook.

The first, isolated staging rehearsal protects `/v1/version` at `$0.01` of
Base Sepolia test USDC: it is a read-only endpoint that can return a 2xx
response without pre-seeding customer or receipt data. Do not promote that
route to production. Once that settlement has been reconciled, switch the
checked-in staging route to `/v1/receipts/:receiptId/bundle` for the separate
bundle rehearsal; do not leave both paid routes enabled merely for
convenience.

For the initial live rehearsal, request `GET /v1/version`, capture the HTTP
402 challenge, and pay exactly one advertised requirement. Retain the
settlement transaction identifier, the resulting `PAYMENT-RESPONSE`, and the
successful 2xx response. Reconcile its network, amount, transaction, payer,
resource URL, and response hash against the terminal `DELIVERED` ledger event.
For an EIP-3009 gasless USDC settlement, the facilitator can be the on-chain
transaction submitter: validate the advertised payer against the
`transferWithAuthorization` calldata and the token `Transfer` log instead of
requiring it to equal the transaction sender.

The repository supplies a confirmation-gated client for this exact operation.
Place the dedicated Base Sepolia test-wallet key only in the ignored
`.env.x402-testnet.local` file as `X402_E2E_PRIVATE_KEY`; do not paste it in chat,
commit it, or reuse an issuer or production wallet. From Node.js 22 or newer,
run:

```sh
npm run x402:staging:pay
```

The command refuses to run without its embedded
`--confirm-single-payment` flag, verifies the only permitted quote is Base
Sepolia test USDC `10000` ($0.01) to the configured staging payee, and rejects
redirects, a changed resource, or more than one signed request. Its output
contains only public reconciliation fields; retain that output with the D1
ledger evidence.

Only after that succeeds, run the separate receipt-bundle rehearsal with a
known staging receipt. The route is intentionally parameterized, but the
confirmation-gated client accepts one explicit receipt ID and rejects any
other request target, redirect, quote change, or second signed request:

```sh
npm run x402:staging:bundle -- \
  --receipt-id psr_... \
  --confirm-single-payment
```

It locally verifies the complete bundle using the issuer public key pinned in
the staging operator configuration, then verifies the attached
`priorseal.x402-payment-evidence.v1` against that same key. Before invoking
the command, put the staging issuer key's independently obtained SHA-256 PEM
fingerprint in an ignored local pin file (for example,
`.env.x402-staging-pin.local`):

```dotenv
PRIORSEAL_STAGING_ISSUER_PUBLIC_KEY_SHA256=<64-lowercase-hex>
```

The client fetches the public key only after it has a matching out-of-band
fingerprint, so HTTPS key discovery is not treated as the trust anchor.
Reconcile that evidence with its own terminal `DELIVERED` ledger event; it is
not evidence for the `/v1/version` settlement. Restore the normal staging
authorization policy after a temporary fixture policy has served its single
execution.

The run is a failure—not a reason to retry automatically—when settlement is
unknown, the resource was withheld, a transaction or amount differs, payment
evidence fails verification, or a terminal ledger event is missing. Preserve
the request/response artifacts according to the deployment's incident and
privacy policy; do not add raw payment payloads or facilitator credentials to
Git or logs.

## 5. Refund record and expansion

Refund execution is external to PriorSeal and requires its own wallet,
approval, and on-chain confirmation. Once an operator has verified that
external refund, a PostgreSQL deployment records its immutable evidence with:

```sh
node --env-file=.env.staging.local scripts/record-x402-refund.mjs \
  --ledger-id xpl_... --network eip155:8453 --transaction 0x... \
  --amount 10000 --reason-code SERVICE_UNAVAILABLE
```

This command records evidence only; it cannot create, sign, or broadcast a
refund. It requires the PostgreSQL `DATABASE_URL_UNPOOLED`. D1 refund records
must be added through the deployment's restricted operator channel until a
separately authenticated D1 control-plane action is introduced.

Promote one additional rail at a time: update the explicit allowlist and
payee configuration, deploy the storage-safe configuration, run the no-charge
staging check, obtain a new small-value GO, and retain its reconciliation
evidence. Production promotion remains a separate approval; staging success
does not authorize a production payment or deployment.
