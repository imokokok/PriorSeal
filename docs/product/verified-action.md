# Verified Action

## The product

**Verified Action** is PriorSeal's primary product for a person using an onchain Agent. It gives a wallet owner, and the Agent or wallet application that serves them, one independently reviewable answer to a narrow question:

> Was this exact action explicitly authorized before it was executed, and did the observed execution stay within that authorization?

It is a product outcome, not another protocol or a replacement for the existing authorization, receipt, or SDK schemas. Integrators retain their wallet, transaction construction, signer, executor, policy, and funds. PriorSeal does not broadcast the subject transaction or create an open-ended mandate.

## What a Verified Action includes

1. A principal signs one bounded, time-limited, single-use authorization for an exact intent.
2. PriorSeal accepts that authorization and records the configured pre-execution proof.
3. The integrator-owned executor submits the subject action.
4. PriorSeal observes the identified execution and reports its finality and supported compliance result.
5. The customer and an independent reviewer receive the first portable verification bundle.

An uncertain, reverted, expired, reorged, unavailable, or mismatched execution is an explicit result. It is never silently converted into permission to retry, broaden the action, or claim completion.

## The four capability layers

`Seal`, `Witness`, `Match`, and `Review` are PriorSeal's capability map. They are not four parallel public products or a reason to infer four independent markets.

| Layer | Responsibility in a Verified Action | Standalone technical use |
| --- | --- | --- |
| **Seal** | Defines the exact action boundary and captures principal authorization. | An integrator can create and verify bounded authorization records. |
| **Witness** | Establishes that the authorization existed before execution at the assurance level the deployment supports. | It can time-evidence an authorization or approved digest, but it does not assess safety or authorize execution by itself. |
| **Match** | Compares the observed execution with the signed authorization and preserves uncertainty. | Observation without authorization is an execution fact; an authorization-compliance claim requires the linked authorization. |
| **Review** | Delivers portable receipts, local verification, and user-controlled exports. | The wallet owner or another reviewer can verify an existing receipt or bundle without wallet access or PriorSeal availability. |

The customer-facing value is the combined result:

```text
Seal → Witness → Match → Review = Verified Action
```

`Witness` is an assurance choice, not a promise that every deployment has the same proof mode. `Review` is a portable, user-controlled delivery capability; it does not make a receipt self-trusting.

## Standard release profile and advanced profiles

The first customer-facing release is intentionally narrower than every profile
implemented in the repository. A **standard Verified Action** is the path that
sales, onboarding, and implementation materials may offer by default. A
deployment must still publish the applicable capabilities and pass its own
production checks before it is described as available.

| Layer | Standard Verified Action | Required boundary |
| --- | --- | --- |
| Seal | A single-use, time-bounded EIP-712 authorization for a supported EVM intent, or a Solana Ed25519 authorization for a complete compiled mainnet-beta message | No session, budget, recurring, or unattended mandate. |
| Witness | A verified RFC 3161 timestamp for the accepted authorization | `issuer` proof is development-only; it is not the standard production assurance claim. |
| Match | A configured EVM transfer or exact-call observation, or a complete compiled Solana mainnet-beta message observation | The configured RPC remains the observation source. Solana binds message bytes; it does not infer arbitrary program semantics. |
| Review | A signed v3 receipt and its first portable verification bundle, checked with an independently pinned issuer key | A downloaded discovery key cannot establish its own trust. |

The following are **advanced profiles**. They are technically supported only
when their documented pins, dependencies, and acceptance checks are present;
they must be explicitly named in a design-partner or integration scope rather
than included in the default product promise.

| Profile | Why it is not standard by default |
| --- | --- |
| Witness quorum | It requires independently operated, configured witnesses and an agreed quorum policy. |
| EVM transparency anchor | It requires a reviewed multisig and confirmed external anchor; the reference anchor contract is not audited. |
| ERC-4337, Safe 4337, and EIP-7702 | Each deployment must pin its EntryPoint, account/module or delegate code and provide the required transaction-trace capability. |
| Hyperliquid spot or perp IOC | The profile relies on the venue's public Info API and has deliberately narrow order and fill semantics. |

Do not silently downgrade a standard path to an advanced profile or upgrade an
advanced profile into a standard claim. The deployment's `GET /v1/capabilities`
response is authoritative for whether a particular profile is configured.

## Agent-first buyer and first engagement

The initial buyer is a person using a wallet-connected Agent who wants to retain the final say over one consequential action. The integrating customer can be that person's wallet or Agent application, but the product is judged by whether the person can understand the proposed action, sign one bounded authorization, and retain evidence they can independently check. The first engagement is one fixed-scope, personal Agent flow—not a generic autonomous-trading offer.

A pilot selects one execution path, names the principal, Agent executor, evidence consumer, supported networks, assurance mode, and success criteria, then asks the user or an independent reviewer to reproduce the result from the exported evidence. See [COLLABORATING.md](../../COLLABORATING.md) for the pilot route and [standalone commercial readiness](standalone-commercial-readiness.md) for the commercial-release boundary.

## Product boundaries

- No wallet custody, transaction-signing keys, transaction broadcast, or subject-chain gas payment.
- No investment recommendation, economic-safety guarantee, token-legitimacy claim, or Agent reputation score.
- No recurring, session, budget, or unattended authorization is implied by a single-use authorization.
- A service payment never establishes authority over the subject transaction.
- Insight can provide separate decision and risk evidence. A commitment can link it to a Verified Action, but the products retain separate trust roots and verification scopes.

## Commercial sequence

1. **Design-partner Verified Action pilot:** one agreed execution path and a portable evidence delivery.
2. **Personal Agent Verified Action:** the standard profile above, repeated and validated through the SDK and API, subject to the applicable payment and production gates.
3. **Agent usability iteration:** improve proposal review, recovery, local evidence handling, and agent-facing integration ergonomics without expanding a single-use authorization into a standing mandate.

Public Evidence and Fresh Evidence Check remain complementary read-only offers. Organization workspaces, SSO, RBAC, and hosted evidence retention are not on the current product roadmap.
