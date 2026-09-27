# PriorSeal product positioning

## Core

**Connect explicit authorization to observed EVM execution with independently verifiable evidence.**

PriorSeal preserves the relationship between what a principal authorized before action and what was observed afterward. A portable receipt lets another party check signed permission, supported ordering evidence, execution state, and compliance with the authorization's bound fields.

Its product path is **bounded intent → principal authorization → acceptance and time evidence → observed execution → signed receipt → independent review**. Agent, treasury, wallet, and transaction-infrastructure teams can use PriorSeal independently of Insight.

中文：**将事前的明确授权与事后的实际执行连接起来，形成可独立验证的证据。**

## Public copy

- Homepage headline: **Authority, before action.**
- Short description: **What was authorized. What was observed. Portable authorization and execution evidence for EVM agents.**
- SDK description: **A TypeScript client linking explicit authorization to observed EVM execution and independently verifiable receipts.**

## Three independently selectable offers

| Offer | Buyer need | Evidence scope |
| --- | --- | --- |
| Insight | Oracle transparency, monitoring, and risk assessment | Oracle observations and assessments; supported execution-price/fill evidence |
| PriorSeal | Explicit authorization and execution accountability | Principal-signed permission, ordering evidence, observed EVM execution, and supported authorization compliance |
| Insight + PriorSeal | Connect assessment, authorization, execution, and review | Linked original artifacts with separate keys, trust checks, and verification scopes |

Combined description: **Oracle risk intelligence, explicit authorization, and verifiable execution evidence for onchain agents.**

中文：**提供预言机风险评估、明确授权与可独立复核的执行证据，连接链上行动的依据、权限和结果。**

## Claim boundaries

- PriorSeal does not construct, sign, or broadcast execution transactions and does not hold transaction-signing keys or funds.
- Compliance concerns the authorization's supported bound fields. It does not guarantee economic safety, token legitimacy, profitability, or an infallible RPC view.
- Independently confirm issuer keys and the expected audience. Discovery keys packaged with evidence cannot establish their own trust.
- Independent ordering evidence depends on proof mode: RFC 3161, witness quorum, or EVM anchor. Issuer-only acceptance has a narrower scope.
- Some checks, including ERC-1271 account authority and EVM anchor inclusion, require external chain state. Do not describe every proof mode as fully offline.
- External assessment commitments bind evidence digests. They do not prove that an application enforced the assessment or make PriorSeal the issuer of that assessment.
- Preserve pending, unavailable, reverted, and reorg states. A signed receipt can contain explicit non-compliance or uncertainty.

Keep current README, homepage, SEO, API descriptions, SDK introductions, collaboration introductions, and repository About copy consistent with this scope. Preserve protocol identifiers, signed fields, frozen examples, and historical records when updating wording.
