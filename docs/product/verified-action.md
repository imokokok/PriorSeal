# Verified Action

## The product

**Verified Action** is PriorSeal's primary product for onchain Agents. It gives a wallet, trading application, treasury system, or Agent builder one independently reviewable answer to a narrow question:

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
| **Review** | Delivers portable receipts, local verification, exports, and enterprise evidence handling. | A reviewer can verify an existing receipt or bundle without wallet access or PriorSeal availability. |

The customer-facing value is the combined result:

```text
Seal → Witness → Match → Review = Verified Action
```

`Witness` is an assurance choice, not a promise that every deployment has the same proof mode. `Review` is a delivery and enterprise-retention capability; it does not make a receipt self-trusting.

## Buyer and first engagement

The initial buyer is a team operating one high-value, Agent-involved execution path: a wallet, trading application, treasury system, or Agent runtime that needs to resolve user-consent, operational-accountability, partner-review, or audit questions. The first engagement is a fixed-scope design-partner pilot, not a generic autonomous-trading offer.

A pilot selects one execution path, names the principal, executor, evidence consumer, supported networks, assurance mode, and success criteria, then asks an independent reviewer to reproduce the result from the exported evidence. See [COLLABORATING.md](../../COLLABORATING.md) for the pilot route and [standalone commercial readiness](standalone-commercial-readiness.md) for the commercial-release boundary.

## Product boundaries

- No wallet custody, transaction-signing keys, transaction broadcast, or subject-chain gas payment.
- No investment recommendation, economic-safety guarantee, token-legitimacy claim, or Agent reputation score.
- No recurring, session, budget, or unattended authorization is implied by a single-use authorization.
- A service payment never establishes authority over the subject transaction.
- Insight can provide separate decision and risk evidence. A commitment can link it to a Verified Action, but the products retain separate trust roots and verification scopes.

## Commercial sequence

1. **Design-partner Verified Action pilot:** one agreed execution path and a portable evidence delivery.
2. **Standardized Verified Action:** repeated, validated pilot path exposed through the SDK and API, subject to the applicable payment and production gates.
3. **Evidence Workspace:** project retention, review, export, and organization controls only after repeated customer demand for those workflows.

Public Evidence, Fresh Evidence Check, and an Evidence Workspace remain complementary offers. They do not replace the primary question answered by a Verified Action.
