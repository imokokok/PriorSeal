# PriorSeal REST handoff

Use this reference only from a reviewed server-side or CLI integration that can
make authenticated HTTPS requests to `https://priorseal.xyz`. It is not a
browser recipe and it must not expose a service credential or wallet key.

## Capability discovery

First call:

```text
GET https://priorseal.xyz/v1/capabilities
```

Require a ready Base exact-call deployment, EIP-712 authorizer, a configured
issuer key, and the returned `audience`. Configuration is not a substitute for
checking the concrete authorization response.

## Prepare, sign, accept

1. Construct an exact-call `intent` from the final reviewed EOA envelope.
   It must include `chainId: 8453`, `sender`, decimal `nonce`, `callTarget`,
   `calldataHash`, decimal `transactionValue`, a short expiry, and the Insight
   assessment context commitment.
2. `POST /v1/authorizations/prepare` with `intent`, `principal`, `authorizer`,
   `delegate`, issuance / expiration bounds and a unique authorization nonce.
3. Compare the canonical response against the requested values. Pass its exact
   EIP-712 payload to Wallet MCP `sign`; never rebuild typed data locally.
4. `POST /v1/authorizations` with the returned authorization, completed
   signature, and an idempotency key. Persist the acceptance response.
5. Only then create the one-call Wallet MCP `send_calls` request.

## Observe

After Wallet MCP returns one canonical Base transaction hash:

```text
POST /v1/executions/observe
```

with the accepted `authorizationId`, `chainId: 8453`, transaction hash, and
the deployment's confirmation policy. Persist the complete response. Retrieve
the final portable artifact only from:

```text
GET /v1/receipts/{receiptId}/bundle
```

when the observation reports a receipt. The bundle's public-key discovery data
is not its own trust anchor: establish the issuer key independently.

## Never do this

- Do not use x402 payment as the authorization of the Base action.
- Do not submit a prepared transaction before the authorization is accepted.
- Do not refresh a transaction nonce or route after authorization.
- Do not retry a broadcast, observation or payment simply because its terminal
  state is unknown.
