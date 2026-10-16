# x402 payments on Base, Arbitrum One, and Monad

PriorSeal's shared Node and Cloudflare Worker API can accept x402 v2 `exact`
EVM payments in USDC on Base (`eip155:8453`), Arbitrum One
(`eip155:42161`), and Monad (`eip155:143`). The API delegates signature
verification and settlement to a facilitator configured by the deployment
operator.

Payment is disabled unless all required `PRIORSEAL_X402_*` settings are
provided. The production Wrangler config sets the supplied EVM payee
`0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231`; this one address is shared by
Base, Arbitrum One, and Monad. The deployment operator still configures the
facilitator, resource origin, paid routes, and their prices. Once configured,
`/v1/capabilities` lists the supported x402 profiles and route price schedule.
A paid request checks the facilitator's current `/supported` response and
offers every configured network it supports. The request returns HTTP 503 if
the facilitator supports none of them.

One `PRIORSEAL_X402_PAY_TO` address and one route/price schedule are shared
across all advertised EVM networks. Monad therefore uses the same payee and
prices as Base when both are offered by the configured facilitator.

## Configure a deployment

Set these values in the API process environment or as Cloudflare Worker
secrets/vars:

| Variable | Required | Purpose |
|---|---:|---|
| `PRIORSEAL_X402_FACILITATOR_URL` | Yes | Facilitator base URL; the service calls `/supported`, `/verify`, and `/settle`. |
| `PRIORSEAL_X402_FACILITATOR_HEADERS_JSON` | No | Per-operation authentication headers, stored as a secret. |
| `PRIORSEAL_X402_PAY_TO` | Yes | EVM address that receives USDC on any advertised chain. |
| `PRIORSEAL_X402_RESOURCE_ORIGIN` | Yes | Public HTTPS API origin used in the x402 resource URL. |
| `PRIORSEAL_X402_ROUTES_JSON` | Yes | Explicit list of paid, read-only GET routes and their prices. |
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

Prices are exact USD strings with up to six decimal places and are converted to
USDC atomic units. Only `/v1/` GET routes are accepted. POST routes remain
outside x402 because the default exact EVM flow settles after the resource
handler; keeping the allowlist read-only avoids charging around a write request
whose response later fails.

Facilitator authentication is independently configured for each operation:

```json
{
  "supported": { "Authorization": "Bearer <facilitator credential>" },
  "verify": { "Authorization": "Bearer <facilitator credential>" },
  "settle": { "Authorization": "Bearer <facilitator credential>" }
}
```

Do not commit real credentials. The parser rejects reserved transport headers,
line breaks, and URLs containing credentials or query parameters. Production
facilitator and public resource URLs must use HTTPS.

For Cloudflare, add each secret to the intended environment with Wrangler, for
example `wrangler secret put PRIORSEAL_X402_FACILITATOR_HEADERS_JSON --env staging`.
Secrets are environment-specific, so configure them separately for staging and
production. The routes JSON, origin, payee, and facilitator URL can be deployed
as environment vars. This repository change does not run Wrangler or deploy a
Worker.

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

Base uses USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; Arbitrum One
uses native USDC at `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (bridged
USDC.e is not accepted); Monad uses USDC at
`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`. Monad's USDC EIP-712 domain
name is `USDC`, version `2`. These token details follow the [x402 EVM default
asset table](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/evm/src/defaultAssets.ts).
Monad's [token guide](https://docs.monad.xyz/developer-essentials/network-information/tokens-and-bridges)
lists USDC as available through Circle CCTP; Arbitrum's native USDC distinction
is documented in [Arbitrum's USDC guide](https://developer.arbitrum.io/arbitrum-bridge/usdc-arbitrum-one).

This integration implements the x402 v2 HTTP header and facilitator lifecycle
for the three configured EVM networks. Monad is mainnet-only here, and appears
in payment challenges only when the configured facilitator advertises x402 v2
`exact` support for `eip155:143` through `/supported`. `/v1/capabilities`
describes configured profiles; each payment challenge reflects the facilitator's
current network support. Facilitator choice, account funding, route pricing,
route selection, and production activation remain deployment configuration.
The offline fixture in
[`examples/402signal-eip3009-settlement-binding-v1`](../../examples/402signal-eip3009-settlement-binding-v1/README.md)
continues to be a separate, synthetic 402Signal route-binding example.
