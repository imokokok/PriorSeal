# PriorSeal agent usage and payment model

## Product decision

PriorSeal is an **agent authorization and evidence layer charged by service
use**. It provides a portable proof trail around a bounded onchain action; it
is not a wallet, an execution venue, a delegated trading mandate, or a general
agent reputation score.

The product promise is:

> An agent may automatically pay for and call PriorSeal, but may act only
> within authorization its principal and an independent reviewer can verify.

## The agent flow

```text
Agent proposes an exact action
  → principal signs a bounded, time-limited authorization
  → PriorSeal accepts and time-evidences it
  → integrator-owned executor submits the action
  → PriorSeal observes it and issues a signed receipt
  → operator or reviewer verifies the portable evidence
```

An agent can automate the preparation, API calls, evidence recovery, local
verification, and storage steps. It cannot infer or mint the principal's
signature. A changed call, expired authorization, consumed nonce, failed
policy, uncertain execution, or non-compliant observation remains an explicit
state—not permission to retry or broaden the action.

## User-controlled Agent mode

For retail-facing wallets and trading applications, the product is not an
autonomous trading bot. It is a **proposal-and-confirmation boundary**:

```text
Agent or application proposes one action
  → it retains a short proposal record and protected integration commits its digest into the exact message intent
  → wallet owner reviews the Agent ID, rationale, limits, fees and expiry
  → owner signs one authorization and the same transaction
  → one relay attempt is observed and exported as evidence
```

The user-facing review must state the maximum spend, minimum output when the
profile supports it, slippage, disclosed platform fee, maximum priority/network
fee, expiry, Agent/application ID, a short retained rationale, and the exact
one-time boundary. It must also make an `UNKNOWN` relay state and the
possibility of failed network fees clear. `priorseal.agent-proposal.v1` commits
the record's SHA-256 digest into the exact intent while the application retains
the readable record. It proves only that this record was linked to that action;
it does not validate the rationale, establish Agent identity, or make a
performance rating unless a separately reviewed identity source is present.

The first retail-facing Jupiter and 0x Solana surfaces use one exact
authorization per swap. They show a countdown to the signed route expiry and
permit a user to discard an unsigned proposal locally. A v2 package retains the
readable proposal record alongside the committed exact route; a package that
commits a proposal without retaining its record is refused before signing. They
do not support unattended execution, recurring trades, a trading budget, or a
reusable session. Those are separate product profiles, not UI toggles.

## Account and trust separation

| Account or role | Permitted purpose | Explicit boundary |
| --- | --- | --- |
| Principal authorizer | Signs the action's intent and limits | Does not automatically pay PriorSeal merely by authorizing an action |
| Agent service payer | Pays for PriorSeal usage | Cannot grant the agent permission over customer assets |
| Agent executor | Signs/submits the customer-owned execution through an integrator-controlled path | Cannot alter the signed call, value, scope, or validity window |
| PriorSeal issuer | Signs acceptance and receipt evidence | Does not custody keys, funds, or customer transaction signing authority |
| Reviewer | Verifies evidence with independently trusted keys and applicable chain state | Does not need wallet access or PriorSeal availability |

An implementation may use one underlying account for more than one role only
when its integrator accepts that risk. A production deployment should prefer a
principal authority distinct from an agent executor when the agent's
transaction key must not itself grant principal authority.

## Commercial stages

| Stage | Customer experience | Commercial mechanism | Status |
| --- | --- | --- | --- |
| Design-partner pilot | One bounded execution path, configured jointly, with portable evidence delivered for review | Fixed-scope pilot, implementation fee, or enterprise service contract | Available now |
| Paid evidence export | A caller purchases an eligible read-only receipt bundle and receives payment-to-resource evidence | x402 `exact` USDC payment | Implemented and rehearsed in staging; production disabled pending a facilitator that actually supports the reviewed Base-mainnet rail |
| Agent runtime orchestration | Agent calls a principal-controlled signing boundary, submits exactly one authorized action through its integrator, then observes and verifies evidence | `priorseal-sdk` `authorizeWithEip712Signer()` / `runAgentAction()` | Implemented; authority and executor infrastructure remain integrator-owned |
| Agent service credits | Operator reviews a pilot request, issues a scoped Agent credential, and can credit or revoke it | Protected operator account endpoints; raw credentials are returned once and never stored by PriorSeal | Current production pilot: operator-managed; public x402 payment and `POST /v1/selfserve/claim` are disabled |
| Session or budget authorization | Principal defines repeatable policy boundaries for an agent | A separately specified and reviewed authorization profile | Later milestone; not implied by current single-use authorization |

## Why x402 is not the authorization protocol

x402 is useful for an agent paying for a service. It is not evidence that the
agent has authority over the subject transaction. In the current `exact`
payment flow, settlement happens after a protected handler returns successfully,
so PriorSeal deliberately restricts x402 to allowlisted, read-only `GET`
resources. Charging a write such as authorization creation or observation
through that flow could leave an ambiguous result when the write or response
fails.

When public paid commerce is separately enabled, self-serve write usage uses a separate prepaid-credit meter rather than x402
settlement. It atomically reserves a configured service credit using the
request's idempotency key, consumes it only for a successful response, and
releases it for a failed response. This must not be substituted with an API key
that silently gives the agent asset-execution authority.

## Prepaid service-credit meter

The Worker can enable a narrow route list through the secret
`PRIORSEAL_AGENT_METER_JSON`. Its exact configuration contains a SHA-256
digest for an operator credential, bootstrap account credential digests, and
the route/credit schedule. `creditUnitUsd` is a decimal USD price per credit;
the API publishes that value and the exact `priceUsd` for each enabled route in
`GET /v1/capabilities`, so an Agent does not need to guess or use floating-point
arithmetic. Each persisted account has only a credential digest, a provisioned
credit balance, and an active/revoked status. Raw credentials are never written
to source, configuration, logs, or the usage ledger. A route is metered only
when it appears in this secret; every other API route retains its existing
behavior.

The first public schedule, once the launch gates below are complete, is:

| Product event | Credits | USD |
| --- | ---: | ---: |
| Authorization acceptance | 3 | $0.03 |
| Observation task that produces the durable receipt path | 9 | $0.09 |
| Standard Evidence Flow | 12 | $0.12 |
| Read-only receipt bundle via x402 | — | $0.02 |
| Higher-assurance time, witness, or anchor evidence | — | separately quoted; not in the initial self-serve meter |

The Agent credit configuration for that schedule uses `creditUnitUsd: "0.01"`.
Status polling, local/offline verification, and a replay of the same
idempotency key are not separately billed. The bundle export is either an x402
purchase or an explicitly configured credit route, never both for the same
request.

The corresponding metered-route portion of the operator secret is:

```json
{
  "schema": "priorseal.agent-meter.v1",
  "creditUnitUsd": "0.01",
  "operatorCredentialHash": "<sha256 digest>",
  "accounts": [],
  "routes": [
    { "routeId": "authorization-acceptance", "method": "POST", "path": "/v1/authorizations", "credits": "3" },
    { "routeId": "execution-observation", "method": "POST", "path": "/v1/executions/observe", "credits": "9" }
  ]
}
```

`priceUsd` is calculated server-side from this schedule and returned in
capabilities; it is not an Agent-supplied field. The placeholder digest is not
a credential and must be replaced only through the deployment secret workflow.

For a metered call, the Agent sends `x-priorseal-agent-key` and an
`idempotency-key`. A successful reply includes the non-secret
`x-priorseal-usage-id`, which is a stable usage-ledger identifier. Repeating an
identical call with the same key does not consume a second credit. Updating an
account's configured provisioned-credit value upward adds only the difference;
setting its status to `revoked` blocks future reservations immediately.

The account holder can call `GET /v1/agent-accounts/self` with its Agent
credential to inspect its own balance and status, and
`GET /v1/agent-accounts/self/usage?limit=25` to inspect its own recent debit
ledger. An operator credential can issue a new account (`POST /v1/agent-accounts`), add credits
(`POST /v1/agent-accounts/{accountId}/credits`), or revoke it
(`POST /v1/agent-accounts/{accountId}/revoke`). Issuance returns the raw
credential once; callers must store it in a secret manager. The holder-facing
SDK methods are `priorseal.agentAccount()` and `priorseal.agentUsage()`. Every
credit operation requires an `idempotency-key`; the stored operation records a
non-secret optional `reference` (such as a provider invoice ID), so retries do
not double-credit the account. Operator endpoints are deliberately
not SDK convenience methods: they are an administrative boundary and should be
called only from a separately protected control plane.

When public paid commerce is enabled, self-serve claims share this ledger: a funded transfer is claimed with a
payer-wallet signature, the account is seeded at zero credits, and the credit
operation keyed by the transaction hash is the only grant path. Because the
credential is deterministically derived from the account, a retried claim
returns the same credential without storing it, and an account provisioned
through the operator flow keeps its operator-issued credential (its claim
fails closed rather than leaking or rotating the secret).

Bootstrap configuration seeds a previously absent account and may increase its
configured credit allowance. It cannot reactivate a revoked account or replace
its persisted credential. This keeps an emergency revoke effective across
requests and restarts.

The operator must apply both `d1/migrations/0003_agent_meter.sql` and
`d1/migrations/0004_agent_meter_credit_operations.sql` (or PostgreSQL
`migrations/013_agent_meter.sql` and
`migrations/014_agent_meter_credit_operations.sql`) before enabling the secret. Startup fails
closed if the required ledger tables are absent. A payment provider is not a
runtime dependency: its settled payment or contracted allowance is reflected by
the authenticated credit operation under the operator's existing change
controls. This is not a payment processor, receipt of funds, tax record, or
automatic refund system.

## Implemented headless-agent path

`priorseal-sdk` now provides `authorizeWithEip712Signer()` for a Node or agent
runtime whose principal signature is supplied by an external,
principal-controlled signer. `runAgentAction()` composes that operation with
one integrator-owned transaction submission callback and the existing durable
observation flow. It validates the signer account, locally verifies the
EIP-712 signature before acceptance, calls the supplied submission callback
only once, and then observes the returned transaction hash.

For separately approved eligible x402 receipt-bundle exports, the SDK also provides
`createX402AgentFetch()`. Its required policy pins service origins and paths
and can cap network, asset, payee, and USDC atomic amount. It accepts a
principal-controlled x402 signer callback, verifies that the returned payment
matches the challenged and permitted requirement, and makes at most one paid
GET retry. It never pays POST requests.

It does not custody a private key, fund an account, choose a transaction,
retry a possibly broadcast transaction, or turn an x402 service payment into
permission. Integrators must treat an uncertain submission as a reconciliation
case and retain the accepted authorization and final receipt.

## Launch gates

No public claim of x402 self-serve agent payments is allowed until all
applicable production x402 gates are complete: a reviewed payment rail and
payee, price schedule, facilitator terms, production ledger migration and
health checks, production issuer and secrets, a passing no-payment Go/No-Go
check, and a separately authorized limited mainnet settlement rehearsal. See
[x402 production Go/No-Go](../runbooks/x402-production-go-no-go.md).

No public commercial launch claim for prepaid Agent credits is allowed until an
operator has reviewed the route price schedule, operator-credential custody,
account-provisioning and revocation runbook, credit-refund and support process,
the applicable D1 or PostgreSQL migration, and a staging lifecycle rehearsal.
The code is an operator-gated capability, not an activated billing service.

No public claim of autonomous, repeatable onchain authorization is allowed
until a dedicated policy/session profile has explicit signed fields, replay and
budget semantics, emergency-stop behavior, receipt semantics, threat modeling,
and independent verification support.
