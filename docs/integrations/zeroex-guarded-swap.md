# 0x Guarded Solana Swap

`priorseal-sdk` can bind 0x Solana Swap API raw instructions to an Insight
pre-sign simulation and a single-use PriorSeal authorization. The workflow is
self-custodial: the wallet alone signs the authorization and transaction; the
application never accepts a wallet private key.

```text
0x /solana/swap-instructions → final v0 message → Insight simulation
  → PriorSeal message authorization → wallet signs unchanged bytes → relay → observation
```

This adapter uses 0x's Solana raw-instruction API, not an 0x-managed signing or
execution service. It is a route and authorization integration, not a quote,
price, settlement, token-safety, or economic-suitability guarantee. 0x's
Solana API is currently beta; pin and test the deployed policy whenever its
response contract changes.

## Supported scope

- Solana mainnet-beta, a self-paying, one-signature wallet, and an `ExactIn`
  transaction compiled as v0.
- `POST /solana/swap-instructions` with `transaction_version: "v0"`.
- A deployment-owned compute-unit limit and price. 0x does not supply these
  instructions, so PriorSeal prepends exactly the two policy-configured Compute
  Budget instructions before the immutable 0x instruction sequence.
- One fresh blockhash, Insight pre-sign simulation, separate Solana Ed25519
  authorization, one relay attempt, and subsequently observed evidence.
- A fresh [0x RFC 9421 response signature](https://docs.0x.org/docs/developer-resources/response-signatures), bound to the exact POST body, response body, endpoint, status and content type. A successful unsigned, stale, malformed, body-modified, or unknown-key response is rejected before parsing its route.
- No sponsorship. A response containing `sponsor` is rejected. The protected
  request also has no recipient, referral-fee, surplus-fee, or arbitrary
  instruction fields, so the browser cannot introduce one.

The adapter validates every raw program key, account key, signer/writable bit,
instruction byte, address lookup table and route field. It then requires the
compiled Solana message to reproduce the complete ordered instruction sequence
before it asks Insight to simulate or a wallet to sign.

## Deployment configuration

The integration is disabled unless all five required server-side variables are
set together. Do not expose either API key in `VITE_*`, browser JavaScript,
logs, prepared packages, or agent prompts.

```bash
ZEROEX_API_KEY=...
INSIGHT_API_KEY=...
PRIORSEAL_ZEROEX_RPC_URL=https://your-reviewed-solana-rpc.example
PRIORSEAL_ZEROEX_RESPONSE_SIGNING_KEYS_JSON='{
  "trustedKeys":[{
    "kty":"OKP",
    "crv":"Ed25519",
    "kid":"0x-signing-key-prod-24092026",
    "x":"19P3C981JsyQsqwVho8Tlabx51rslvdruSH59mGuWn0"
  }]
}'
PRIORSEAL_ZEROEX_POLICY_JSON='{
  "maxInputAmountAtomic":"2000000",
  "maxSlippageBps":50,
  "allowedInputMints":["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  "allowedOutputMints":["So11111111111111111111111111111111111111112"],
  "allowedProgramIds":["ComputeBudget111111111111111111111111111111","...reviewed 0x route programs..."],
  "allowedAddressLookupTables":["...optional reviewed table addresses..."],
  "computeUnitLimit":200000,
  "computeUnitPriceMicroLamports":"100",
  "maxComputeUnitLimit":200000,
  "maxComputeUnitPriceMicroLamports":"100",
  "maxPriorityFeeLamports":"20",
  "authorizationTtlSeconds":60
}'
```

`INSIGHT_API_KEY` can be shared with the guarded Jupiter integration, but
`ZEROEX_API_KEY`, the RPC URL and the policy are independent. Optional
`PRIORSEAL_ZEROEX_ROUTER_BASE_URL` and
`PRIORSEAL_ZEROEX_INSIGHT_BASE_URL` are HTTPS-only test or approved service
overrides.

`PRIORSEAL_ZEROEX_RESPONSE_SIGNING_KEYS_JSON` is non-secret and intentionally
required. Populate it only from 0x's published response-signature key registry.
Select a key by `kid`, never list position. Before a documented key rotation,
add the announced next JWK beside the current one; after retirement, remove the
old JWK. Do not silently disable signature verification to work around a key
rotation or provider outage.

The program allowlist must be derived from real, reviewed 0x routes for the
specific assets and product scope. Do not copy a broad program list from a
third party. Pin lookup tables where your operational route set permits it.
Set every compute and priority-fee cap; the service rejects a policy whose cap
is below its configured compute budget.

### Tenant-bound commercial fees

Fees are disabled unless `PRIORSEAL_ZEROEX_TENANTS_JSON` is configured. Do
not put `commercialFee` in `PRIORSEAL_ZEROEX_POLICY_JSON`: the base policy is
the universal safety ceiling, while a tenant policy may only narrow it.

`0x` receives a sell-side fee only from this server-owned configuration. The
browser cannot set a fee rate, recipient, tenant, or fee side. Before a quote
is requested, PriorSeal reads the configured recipient from Solana RPC and
requires it to be an existing parsed SPL or Token-2022 token account for the
input mint. The service then binds the fee terms, expected atomic fee, and
tenant ID into a `priorseal.zeroex-commercial-record.v1` context commitment
inside the exact authorization.

```json
{
  "schema": "priorseal.zeroex-tenant-policy-set.v1",
  "defaultTenantId": "public",
  "tenants": [
    {
      "tenantId": "public",
      "allowedInputMints": ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
      "maxInputAmountAtomic": "1000000",
      "maxSlippageBps": 25
    },
    {
      "tenantId": "partner-a",
      "agentAccountId": "agent-partner-a",
      "allowedInputMints": ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
      "maxInputAmountAtomic": "500000",
      "maxSlippageBps": 10,
      "commercialFee": {
        "profileId": "partner-a-usdc-5bps",
        "inputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "feePpm": 500,
        "recipientTokenAccount": "<reviewed-existing-USDC-token-account>",
        "side": "sell"
      }
    }
  ]
}
```

`feePpm` is one-millionth of the input amount: `500` is 5 bps (0.05%) and
`1000` is 10 bps (0.10%). The expected fee is rounded up in atomic units. A
configured Agent tenant is selected only when the prepare route is also
metered by `PRIORSEAL_AGENT_METER_JSON` and its authenticated account ID
matches `agentAccountId`; callers never submit a tenant ID. The default tenant
must not require an Agent account. In a deployment configuration, every
fee-bearing tenant must bind an active configured Agent account and at least
one of `POST /v1/0x/guarded-swaps/prepare` or
`POST /v1/solana/guarded-swaps/prepare` must be a metered route. This keeps
the public/default tenant fee-free and makes a commercial fee attributable to
an eligible partner account before any quote is prepared.

## Protected HTTP contract

When deployment capabilities report
`integrations.guardedZeroEx.enabled: true`, the same-origin service exposes:

- `POST /v1/0x/guarded-swaps/prepare`
- `POST /v1/0x/guarded-swaps/submit`
- `POST /v1/solana/guarded-swaps/prepare`
- `POST /v1/solana/guarded-swaps/submit`

Preparation accepts only `inputMint`, `outputMint`, positive atomic `amount`,
the self-paying `taker`, `slippageBps`, optional
`minimumOutputAmountAtomic`, and optional PriorSeal context commitments. It
returns a `PreparedGuardedZeroExSwap` and a non-secret review.

Submission accepts a fresh accepted authorization ID, that exact prepared
package, and a wallet-signed transaction. The relay verifies the unsigned and
signed message hashes, verifies the payer signature, atomically consumes the
authorization, and sends the bytes once with no automatic retry. For a
fee-bearing transaction it first writes an immutable
`priorseal.zeroex-commercial-ledger.v1` `RELAY_ATTEMPTED` event. If that write
is unavailable, it does not consume the authorization or broadcast the swap.
It then records `RELAY_SUBMITTED`, `RELAY_UNKNOWN`, or `RELAY_NOT_CLAIMED` as
applicable. The ledger contains the tenant, disclosed fee terms, authorization
and signature—but never wallet keys or signed transaction bytes. A submitted
relay is still *unconfirmed*: observe that exact Solana signature before
reporting execution or recognising any fee as settled.

The service has no endpoint that signs for the wallet, rebuilds a quote after
authorization, accepts an arbitrary raw transaction, or accepts caller-provided
fee and sponsorship parameters. The unified prepare endpoint requires an
explicit `provider` (`"0x"` or `"jupiter"`) before authorization. The unified
submit endpoint ignores a caller-selected provider and derives it from the
prepared schema, so it cannot silently route an authorized package elsewhere.

## SDK use

```ts
import {
  assertPreparedGuardedZeroExSwap,
  authorizeGuardedZeroExSwap,
  observeGuardedZeroExSwap,
  reviewGuardedZeroExSwap,
} from 'priorseal-sdk'

const prepared = await fetch('/v1/0x/guarded-swaps/prepare', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ inputMint, outputMint, amount, taker: wallet.publicKey, slippageBps: 50 }),
}).then((response) => response.json())

await assertPreparedGuardedZeroExSwap(prepared.prepared)
const review = await reviewGuardedZeroExSwap(prepared.prepared)

const accepted = await authorizeGuardedZeroExSwap({
  client: priorseal,
  prepared: prepared.prepared,
  wallet, // { publicKey, signMessage }; no private key crosses the SDK boundary
  principal: { type: 'user', id: 'user:42' },
  agentId: 'agent:swap-console',
})

// Your wallet signs the exact base64 transaction. Compare its serialized
// message bytes before POSTing it to /v1/0x/guarded-swaps/submit.
const observation = await observeGuardedZeroExSwap({
  client: priorseal,
  authorizationId: accepted.authorization.authorizationId,
  signature: transactionSignature,
})
```

The console is available at `/app/0x-guarded-swap` only when capabilities say
the integration is ready. It keeps provider credentials server-side, displays
atomic limits and exact transaction identifiers before signing, and exports a
portable evidence package after observation.

## Commercial use

The adapter can support a commercial product because the operator controls the
customer experience, policy, eligibility, billing and evidence service. It
does not itself create revenue and it does not give the operator custody.
Potential models include a paid embedded trading workflow, organization-level
authorization/evidence plans, or a separate disclosed service fee where the
applicable 0x and Solana rules, token permissions, licensing, consumer terms,
and jurisdictional obligations have been reviewed. Do not represent the
simulation, 0x route, or PriorSeal receipt as execution, price, or regulatory
guarantee.

For migrations, production gating, reconciliation states, and the explicit
human decisions still needed before charging users, follow
[the 0x commercial production runbook](../runbooks/zeroex-commercial-production.md).
