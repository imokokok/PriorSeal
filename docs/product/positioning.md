# PriorSeal product positioning

## Core

**Connect explicit authorization to observed EVM execution with independently verifiable evidence.**

PriorSeal preserves the relationship between what a principal authorized before action and what was observed afterward. A portable receipt lets another party check signed permission, supported ordering evidence, execution state, and compliance with the authorization's bound fields.

Its product path is **bounded intent → principal authorization → acceptance and time evidence → observed execution → signed receipt → independent review**. Agent, treasury, wallet, and transaction-infrastructure teams can use PriorSeal independently of Insight.

中文：**将事前的明确授权与事后的实际执行连接起来，形成可独立验证的证据。**

## Agent-native commercial framing

PriorSeal is the **per-use authorization and evidence layer for agents**. An
agent can prepare a bounded action, call PriorSeal to obtain authorization and
observation evidence, and retrieve a portable receipt for its operator or a
reviewer. The principal—not PriorSeal and not the agent's service-payment
wallet—retains control of the onchain action through an explicit signed
authorization.

This deliberately separates three roles that can be held by different
accounts:

| Role | What it controls | What it cannot establish alone |
| --- | --- | --- |
| Service payer | Payment for PriorSeal API usage | Permission to execute the subject transaction |
| Principal / authorizer | The bounded action the agent may take | Settlement of a PriorSeal service charge |
| Executor | Submission of the subject transaction | A broader authorization than the signed intent |

The eventual self-serve payment mechanism can be x402 or another reviewed
prepaid-usage design, but it does not replace principal authorization. A
payment rail is separate from the subject-execution chain and never proves
that the subject action was authorized.

中文：**PriorSeal 是 Agent 按调用使用的授权与证据层；Agent 可以自动为服务
付费，但只能在授权人可独立证明的边界内行动。**

独立商业化的当前范围、已验证能力与生产上线门槛见
[PriorSeal 独立商业化就绪度](standalone-commercial-readiness.md)。

## Public copy

- Homepage headline: **Authority, before action.**
- Short description: **Authorization and execution evidence for agents—what was authorized, what was observed, and what an independent reviewer can verify.**
- SDK description: **A TypeScript client for agents to prepare explicit authorization, observe EVM execution, and produce independently verifiable receipts.**

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
