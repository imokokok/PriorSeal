# x402 payments on aligned EVM networks and Solana

PriorSeal's shared Node and Cloudflare Worker API can accept x402 v2 `exact`
USDC payments on Ethereum, OP Mainnet, Polygon PoS, Monad, HyperEVM, X Layer,
Sei, Base, Arbitrum One, Avalanche C-Chain, and BNB Smart Chain. It can also accept
Solana mainnet USDC (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`). The API
delegates signature verification and settlement to a facilitator configured by
the deployment operator. The actual `PAYMENT-REQUIRED` response contains only
locally configured payment families that the facilitator currently advertises
through `/supported`.

Payment is disabled unless all required `PRIORSEAL_X402_*` settings are
provided. An EVM payee is shared across every EVM option; a Solana merchant
public key is separate. The deployment operator still configures the
facilitator, resource origin, paid routes, and their prices. Once configured,
`/v1/capabilities` lists only the locally enabled payment families that the
current facilitator reports as supported, plus the route price schedule. A paid
request applies the same current `/supported` check and offers only compatible
networks. If facilitator discovery is unavailable, discovery publishes no
payment rail and a paid request fails closed rather than advertising an
unsettleable option.

One `PRIORSEAL_X402_PAY_TO` address and one route/price schedule are shared
across advertised EVM networks. `PRIORSEAL_X402_SOLANA_PAY_TO` is the Solana
merchant public key for mainnet USDC. Configure one or both; a deployment may
operate as EVM-only, Solana-only, or accept both payment families.

## Configure a deployment

Set these values in the API process environment or as Cloudflare Worker
secrets/vars:

| Variable | Required | Purpose |
|---|---:|---|
| `PRIORSEAL_X402_FACILITATOR_URL` | Yes | Facilitator base URL; the service calls `/supported`, `/verify`, and `/settle`. |
| `PRIORSEAL_X402_FACILITATOR_URLS` | No | Per-network facilitator overrides as comma-separated `network=url` pairs (for example `eip155:56=https://facilitator.aeon.xyz` or `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp=https://facilitator.payai.network`); each entry must reference a known rail and an HTTPS URL. May be combined with CDP authentication — CDP bearer JWTs are only ever attached to the CDP base URL, never to an override. |
| `PRIORSEAL_X402_FACILITATOR_HEADERS_JSON` | No | Per-operation authentication headers, stored as a secret. |
| `PRIORSEAL_X402_FACILITATOR_AUTH_MODE` | No | Set only to `cdp` for CDP's hosted facilitator; it creates a short-lived JWT for each operation. |
| `PRIORSEAL_X402_CDP_API_KEY_ID` | With `AUTH_MODE=cdp` | CDP API-key identifier, stored as a Worker secret. |
| `PRIORSEAL_X402_CDP_API_KEY_SECRET` | With `AUTH_MODE=cdp` | CDP 64-byte Ed25519 API-key secret, stored as a Worker secret. |
| `PRIORSEAL_X402_PAY_TO` | One payee required | EVM address that receives USDC on configured EVM networks. |
| `PRIORSEAL_X402_SOLANA_PAY_TO` | One payee required | Solana merchant public key that receives mainnet USDC. |
| `PRIORSEAL_X402_NETWORKS` | Yes in staging/production | Comma-separated, exact CAIP-2 payment-rail allowlist. |
| `PRIORSEAL_X402_RESOURCE_ORIGIN` | Yes | Public HTTPS API origin used in the x402 resource URL. |
| `PRIORSEAL_X402_ROUTES_JSON` | Yes | Explicit list of paid GET routes and their prices. Public evidence routes are read-only; a fixed Credit-pack checkout is the narrowly constrained checkout exception described below. |
| `PRIORSEAL_X402_CREDIT_PACKS_JSON` | No | Fixed x402-to-Credits SKU list. Requires `PRIORSEAL_AGENT_METER_JSON`, and every SKU must have an exactly matching `GET /v1/agent-credit-packs/{packId}/checkout` route and price. |
| `PRIORSEAL_X402_TIMEOUT_MS` | No | Facilitator request timeout; defaults to 15000, allowed range 1000–2147483647. |

Example route configuration (choose the price and routes for the deployment):

```json
[
  {
    "method": "GET",
    "path": "/v1/receipts/:receiptId/bundle",
    "description": "Export a portable PriorSeal receipt bundle",
    "price": "$0.01"
  }
]
```

`bazaar` is optional route metadata. Use it for a paid route with query input
so an agent can construct a purchase request without guessing the parameters.
For example, the receipt-independent integration-readiness product declares
both its exact input and its signed output format:

```json
{
  "method": "GET",
  "path": "/v1/integration-readiness",
  "description": "Issue a signed read-only EVM integration-readiness report",
  "price": "$0.02",
  "bazaar": {
    "input": {
      "queryParams": {
        "chainId": "8453",
        "subjectAddress": "0x0000000000000000000000000000000000000000"
      },
      "querySchema": {
        "properties": {
          "chainId": { "type": "string", "pattern": "^[1-9][0-9]{0,9}$" },
          "subjectAddress": { "type": "string", "pattern": "^0x[0-9a-fA-F]{40}$" }
        },
        "required": ["chainId", "subjectAddress"]
      }
    },
    "output": {
      "format": "priorseal.integration-readiness.v1",
      "example": { "schema": "priorseal.integration-readiness.v1" }
    }
  }
}
```

The static route deliberately has no `routeTemplate`: that field describes
dynamic path parameters such as `:receiptId`, not query parameters.

Prices are exact USD strings with up to six decimal places and are converted
into each rail's settlement-token atomic units: the canonical micro-USDC grid
(6 decimals) is used as-is on 6-decimal tokens and shifted losslessly on
deviating tokens such as BNB Smart Chain's 18-decimal bridged USDC. Only
`/v1/` GET routes are accepted. POST routes remain outside x402 because the
default `exact` flow can settle after the resource handler; keeping ordinary
state-changing APIs on credits avoids charging around a write request whose
response later fails. The sole commerce exception is a fixed Credit-pack
checkout GET: it first records a payment-ledger-bound, idempotent pending
purchase and credits an already authenticated Agent account only after the
facilitator reports settlement. It cannot create an authorization, sign or
broadcast a subject-chain transaction, or select an arbitrary price or credit
quantity.

`PRIORSEAL_X402_NETWORKS` is intentionally a deployment rollout control, not
a list of every rail the binary understands. Staging and production reject an
implicit all-rail configuration. Every selected EVM rail requires the EVM
payee; selected Solana requires the Solana payee. Start with a narrow list and
use the [staging rollout runbook](../runbooks/x402-staging.md) to verify the
deployed API and facilitator before any paid rehearsal.

### Per-network facilitator routing

Networks inherit `PRIORSEAL_X402_FACILITATOR_URL` unless
`PRIORSEAL_X402_FACILITATOR_URLS` overrides them. `/supported` is queried per
distinct facilitator and the exact-v2 networks are merged; `/verify` and
`/settle` for a payment always go to the facilitator serving its network.
Overrides may coexist with CDP authentication: CDP bearer JWTs are bound to the
CDP base URL, so they are attached only when the target endpoint is the CDP
facilitator itself and are never sent to an overridden endpoint.

BNB Smart Chain (`eip155:56`) settles Binance-bridged USDC (18 decimals,
`0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`). The bridged token exposes no
on-chain EIP-3009 domain, so this rail requires a facilitator that verifies
its own mandate-flow authorization — the AEON facilitator advertises exact v2
on `eip155:56` and is the validated production pairing (first exercised in
Insight production, 2026-10-17). This is the canonical CDP-plus-override
shape: CDP serves Base, the AEON override serves BNB:

```dotenv
PRIORSEAL_X402_NETWORKS=eip155:8453,eip155:56
PRIORSEAL_X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
PRIORSEAL_X402_FACILITATOR_URLS=eip155:56=https://facilitator.aeon.xyz
```

Record the facilitator's live `/supported` response for `eip155:56` in the
change record before enabling the rail, exactly as the
[production Go/No-Go](../runbooks/x402-production-go-no-go.md) requires for a
new mainnet rail.

HyperEVM (`eip155:999`) uses [Circle-native USDC](https://www.circle.com/multi-chain-usdc/hyperevm)
at `0xb88339CB7199b77E23DB6E890353E22632Ba630f` on the ordinary six-decimal
USDC grid. Its chain ID is 999, as documented by
[Hyperliquid](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm).
PriorSeal includes the rail but does not select or endorse a facilitator for
it: enable it only after the candidate's live `/supported` response contains
the exact-v2 `exact` + `eip155:999` tuple and its verification and settlement
responses pass the no-payment rollout check. A dedicated facilitator can be
routed without changing the default:

```dotenv
PRIORSEAL_X402_NETWORKS=eip155:999
PRIORSEAL_X402_FACILITATOR_URL=https://REPLACE_WITH_APPROVED_X402_V2_FACILITATOR
PRIORSEAL_X402_FACILITATOR_URLS=eip155:999=https://facilitator.ultravioletadao.xyz
```

If the deployment will also observe HyperEVM subject transactions, configure
`PRIORSEAL_RPC_HYPEREVM` with a reviewed HyperEVM JSON-RPC endpoint. Payment
acceptance and subject-chain observation are separate opt-ins.

For Solana, the resource server obtains the sponsor's public `feePayer` from
the facilitator's exact-v2 network metadata (`kinds[].extra.feePayer`). This
per-network value takes precedence over a wildcard signer list because a
facilitator may advertise fee payers for both mainnet and devnet. For older
responses that omit the exact-network value, PriorSeal accepts only one valid
mainnet (or `solana:*`) signer. The client signs a partially signed SPL USDC
payment transaction; the sponsor performs the final fee-payer signature and
submission. Missing, malformed, or ambiguous metadata fails closed instead of
producing an unusable quote.

For a generic x402 v2 facilitator, authentication is independently configured
for each operation:

```json
{
  "supported": { "Authorization": "Bearer <facilitator credential>" },
  "verify": { "Authorization": "Bearer <facilitator credential>" },
  "settle": { "Authorization": "Bearer <facilitator credential>" }
}
```

CDP's hosted facilitator uses endpoint-bound, short-lived API-key JWTs rather
than a static header. Select it only with this exact URL and mode:

```dotenv
PRIORSEAL_X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
PRIORSEAL_X402_FACILITATOR_AUTH_MODE=cdp
```

Set `PRIORSEAL_X402_CDP_API_KEY_ID` and
`PRIORSEAL_X402_CDP_API_KEY_SECRET` as Worker secrets. CDP mode accepts only
its official URL, requires a 64-byte Ed25519 API-key secret, and rejects
`PRIORSEAL_X402_FACILITATOR_HEADERS_JSON` so a stale static bearer token cannot
override dynamically generated authentication. It does not use a CDP wallet
secret or the merchant's EVM/Solana private key.

Do not commit real credentials. The parser rejects reserved transport headers,
line breaks, and URLs containing credentials or query parameters. Production
facilitator and public resource URLs must use HTTPS.

For Cloudflare, use the reviewed `wrangler versions secret` workflow for each
environment, then upload and validate a new version through the normal release
gate. `wrangler secret put` is itself an immediate deployment and is not a
staging substitute. Secrets are environment-specific, so configure them
separately for staging and production. The routes JSON, origin, payee, and
facilitator URL can be deployed as environment vars.

## Request and settlement behavior

- An unpaid request receives HTTP 402, a `PAYMENT-REQUIRED` header, and a JSON
  body containing each network the facilitator currently supports.
- A paid request supplies the base64 JSON x402 v2 payload in
  `PAYMENT-SIGNATURE`. The facilitator verifies the selected option before the
  GET handler runs.
- The facilitator settles only after the GET handler returns a 2xx response.
  A failed handler is returned without settlement. If settlement fails, the
  protected response body is withheld and the 402 response includes the
  facilitator result in `PAYMENT-RESPONSE`. A `settlement_pending` result is
  retried once with the same payload so a facilitator can reconcile a broadcast
  transaction.
- Successful responses include `PAYMENT-RESPONSE` and use private, no-store
  caching. CORS preflight allows `PAYMENT-SIGNATURE` and exposes the two
  payment response headers to configured browser origins.
- Facilitator errors fail closed with HTTP 503. Neither its credentials nor raw
  response body are included in API errors or logs.

## Fixed Agent Credit packs

PriorSeal has two distinct payment layers, with deliberately different safety
properties:

| Customer need | Payment | Why it is separate |
|---|---|---|
| Read a readiness report or obtain an independent/later evidence export | Per-request x402 payment | The result is a self-contained, read-only digital good. |
| Accept a signed authorization and observe an execution | Agent Credits | These are stateful, idempotent workflow operations; a reservation is consumed only after successful work. The standard 12-credit action includes its first portable evidence bundle. |
| Add capacity to an existing Agent account | Fixed x402 Credit-pack checkout | x402 is used only to buy a predefined prepaid SKU, then credits continue to meter the stateful workflow. |

Credit packs are configured, not client-selected. For example, this
configuration exposes a 100-credit, $1.00 SKU only when the matching x402 route
also quotes `$1.00`:

```json
{
  "schema": "priorseal.x402-credit-packs.v1",
  "packs": [
    { "packId": "standard-100", "credits": "100", "priceUsd": "1.00" }
  ]
}
```

An existing Agent account calls `GET
/v1/agent-credit-packs/standard-100/checkout` with its
`X-PRIORSEAL-AGENT-KEY`. It receives the normal x402 challenge, pays one of the
currently advertised rails, and receives `CREDITS_GRANTED` after settlement.
The response has an opaque `purchaseId`; only the same authenticated account
may inspect `GET /v1/agent-credit-packs/purchases/{purchaseId}`. A successful
retry cannot create more credits because the purchase ID is deterministically
bound to the immutable x402 payment-ledger identity.

If settlement succeeds but credit delivery cannot be completed, the API returns
`503 CREDIT_PURCHASE_PENDING` rather than falsely declaring payment failure or
crediting twice. The durable `AUTHORIZED` purchase is then reconciled by an
operator against the facilitator's settlement and credit-operation records.
That error includes the opaque `purchaseId` so the authenticated account holder
can inspect its delivery state without exposing a payment signature.
Do not ask the buyer to make another payment for that same purchase. A credit
pack grants only PriorSeal service capacity. It never supplies wallet custody,
principal authorization, transaction signing, or transaction broadcast power.

## Signed integration-readiness report

When the deployment includes `GET /v1/integration-readiness` in its paid route
configuration, a buyer can request:

```text
GET /v1/integration-readiness?chainId=8453&subjectAddress=0x...
```

The response is a short-lived, issuer-signed
`priorseal.integration-readiness.v1` report. It performs only two EVM JSON-RPC
reads on a configured supported chain: `eth_chainId` and `eth_getCode`. The
report records whether the chain/RPC is configured and currently reachable,
whether the supplied public address had empty code or contract bytecode, the
input hash, issuer/key identifier, expiration, and a hash of the public key
registry. It is useful as a portable integration preflight without needing an
earlier PriorSeal receipt.

The published zero address is a **smoke-test input**: it verifies discovery,
payment, signing, and delivery, but says nothing useful about an intended
integration target. Its signed `workflow.stage` is `SMOKE_TEST` and its first
signed `workflow.nextActions` entry supplies the exact real-target request
template. Replace `{publicEvmAddress}` with the public EOA or contract you
actually intend to integrate, request that separate report, then read the
signed capability and controlled-execution links. A non-zero target report is
marked `TARGET_INSPECTED`; neither stage grants signing or broadcast authority.

For privacy-preserving aggregate attribution, an integration may add the
optional header `X-PriorSeal-Entry-Source` with one fixed value: `direct`,
`docs`, `bazaar`, `mcp`, or `sdk`. It is only a bounded operational label and
is not an account, wallet, campaign ID, price input, or authorization signal.

It is not an ownership proof, contract audit, safety rating, authorization, or
transaction right. It never requests a wallet key, signs a subject-chain
transaction, broadcasts a transaction, or treats payment as execution
authority. Unsupported or unavailable chains still receive a signed negative
readiness result when the route can deliver one; callers should independently
verify the report signature and apply their own RPC and security review.

## Payment-to-evidence binding for paid receipt bundles

When a caller pays to export `GET /v1/receipts/:receiptId/bundle` and the
PriorSeal issuer signing key is configured, the returned verification bundle
also contains a signed `priorseal.x402-payment-evidence.v1` object. It binds:

- a hash of the payment payload (not the raw, potentially sensitive payload);
- the accepted x402 requirement and successful settlement result;
- the resource URL, HTTP success status, and the pre-extension bundle hash;
- the issuer, key ID, issue time, and Ed25519 signature.

The original execution receipt remains unchanged. Consumers verify the payment
evidence with the issuer key from the bundled registry (after establishing
trust in that key out of band) and independently reconcile the settlement on
its own payment network. A Solana `payer`, if a facilitator returns one, is
facilitator-provided settlement metadata; it must not be assumed to identify
either the SPL token authority or the `feePayer` sponsor without
facilitator-specific validation. Payment and subject-execution networks remain
independent. On an EVM EIP-3009 rail, the facilitator may submit
`transferWithAuthorization` as the on-chain transaction sender. Reconciliation
must therefore bind the quoted `payer` to the USDC authorization calldata and
the ERC-20 `Transfer` log, rather than assuming the transaction submitter is
the token payer.
The public core API exports `verifyX402PaymentEvidence()` for this signature
and binding check.

The server also persists an immutable, privacy-minimised payment/delivery
ledger. It records authorization, withheld resource, settlement result,
delivery, and externally verified refund-record events. It never stores the
raw payment payload—only its hash—and it is not exposed as a public buyer API.
Operators reconcile it with the facilitator and payment network through the
[staging rollout runbook](../runbooks/x402-staging.md).

The EVM USDC contracts and their EIP-712 domain names are pinned in the source
network registry and follow the [x402 EVM default asset
table](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/evm/src/defaultAssets.ts).
Solana mainnet uses the canonical USDC mint
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Facilitator support, not
this static registry, decides what a live deployment advertises.

This integration implements the x402 v2 HTTP header and facilitator lifecycle
for the configured EVM and Solana networks. `/v1/capabilities` describes
locally configured payment families; each payment challenge reflects the
facilitator's current network support. A payment rail is distinct from an EVM
or Solana execution-observation capability; see the [chain capability
matrix](../architecture/chain-capabilities.md). Facilitator choice, account
funding, route pricing, route selection, and production activation remain
deployment configuration.
The offline fixture in
[`examples/402signal-eip3009-settlement-binding-v1`](../../examples/402signal-eip3009-settlement-binding-v1/README.md)
continues to be a separate, synthetic 402Signal route-binding example.
