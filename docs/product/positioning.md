# PriorSeal product positioning

## Core

**Prove that an Agent-involved onchain action was explicitly authorized before execution and stayed within its approved boundary.**

PriorSeal's primary product is **Verified Action**. It preserves the relationship between what a principal authorized before action and what was observed afterward. A portable receipt lets another party check signed permission, supported ordering evidence, execution state, and compliance with the authorization's bound fields.

Its product path is **Agent proposal → bounded intent → principal authorization → acceptance and time evidence → observed execution → signed receipt → independent review**. A wallet owner, a high-value operations team, or the wallet and Agent application serving them can adopt this bounded path without giving PriorSeal custody or transaction-signing power.

中文：**证明 Agent 参与的链上行动在执行前获得了明确授权，并且实际执行没有超出批准边界。**

## Agent-native commercial framing

PriorSeal delivers **Verified Action**, the per-use authorization-and-execution proof for Agents and the people they serve. An Agent can prepare a bounded action, call PriorSeal to obtain authorization and observation evidence, and retrieve a portable receipt for its user, operator or reviewer. The principal—not PriorSeal and not the Agent's service-payment wallet—retains control of the onchain action through an explicit signed authorization.

This deliberately separates three roles that can be held by different
accounts:

| Role | What it controls | What it cannot establish alone |
| --- | --- | --- |
| Service payer | Payment for PriorSeal API usage | Permission to execute the subject transaction |
| Principal / authorizer | The bounded action the agent may take | Settlement of a PriorSeal service charge |
| Executor | Submission of the subject transaction | A broader authorization than the signed intent |

An existing Agent account can buy a fixed prepaid Credits pack through x402;
those credits then meter stateful authorization and observation work. Public,
independent evidence resources remain per-request x402 products. Neither
payment form replaces principal authorization. A payment rail is separate from
the subject-execution chain and never proves that the subject action was
authorized.

中文：**Verified Action 是 Agent 按调用使用的行动证明：Agent 可以自动为服务
付费，但只能在授权人可独立证明的边界内行动。**

独立商业化的当前范围、已验证能力与生产上线门槛见
[PriorSeal 独立商业化就绪度](standalone-commercial-readiness.md)。

## Public copy

- Homepage headline: **Agent-ready. User-controlled. Independently provable.**
- Short description: **Verified Action proves what a principal authorized before an EVM or Solana Agent action, what was observed afterward, and whether the supported fields matched.**
- SDK description: **A TypeScript client for Agents and wallets to prepare explicit authorization, observe EVM and Solana execution, match supported fields, and produce independently verifiable receipts.**

## Product architecture, not four SKUs

`Seal`, `Witness`, `Match`, and `Review` are the four layers behind a Verified Action. They provide a stable way to organize product documentation and future capabilities, but they are not four parallel launches:

| Layer | Customer-facing role | Commercial role now |
| --- | --- | --- |
| Seal | Bounded principal authorization | Required input to a Verified Action |
| Witness | Proof that approval preceded execution | Assurance selection for the agreed path |
| Match | Observed execution against approved boundaries | Primary value customers evaluate |
| Review | Portable verification and user-controlled evidence handling | Included delivery; local evidence is the default |

The commercial offer remains one **Verified Action**. A separate execution observation can be useful, but without a linked authorization it must not be marketed as authorization compliance. The default commercial promise is the [standard Verified Action profile](verified-action.md#standard-release-profile-and-advanced-profiles); advanced profiles require explicit deployment and customer scope.

## Current product direction: bounded high-value Agent actions

PriorSeal is currently optimizing for **one consequential action, one explicit authorization boundary, and one portable proof trail**. That works for an individual wallet owner and for a wallet, treasury, or Agent application implementing a defined high-value path. The product work priority is understandable proposal review, explicit confirmation, one-time execution recovery, and evidence a user or independent reviewer can keep and verify. It is not generic organization workflow software: do not add SSO, RBAC, hosted team archives, approval chains, or enterprise retention as roadmap work without a new product decision.

## Three independently selectable offers

| Offer | Buyer need | Evidence scope |
| --- | --- | --- |
| Insight | Oracle transparency, monitoring, and risk assessment | Oracle observations and assessments; supported execution-price/fill evidence |
| PriorSeal | Verified Action: explicit authorization and execution accountability | Principal-signed permission, ordering evidence, observed EVM or Solana execution, and supported authorization compliance |
| Insight + PriorSeal — **Trusted Agent Execution** | Make one high-value Agent decision inspectable, explicitly authorized and independently provable | Linked original artifacts with separate keys, trust checks, and verification scopes |

Combined description: **Trusted Agent Execution: oracle risk intelligence, explicit authorization, and verifiable execution evidence for high-value onchain Agent actions.**

中文：**可信 Agent 执行：提供预言机风险评估、明确授权与可独立复核的执行证据，连接链上行动的依据、权限和结果。**

### Flagship solution: Trusted Agent Execution

The flagship is one buyer outcome, not a merged trust system or a fifth protocol:

`Insight assessment → integrator-owned execution boundary → principal's bounded authorization → observed execution → PriorSeal receipt → independent review`

| Stage | Responsible party | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| Decision | Insight | The signed assessment or simulation evidence for the proposed action | Authority to transact or proof that an application enforced the assessment |
| Control | Wallet, Safe, policy service, or Agent runtime | Whether the integrator requires the named evidence and authorization before its own submission path proceeds | A PriorSeal claim that every execution path was gated |
| Accountability | PriorSeal | The scope and timing of authorization, observed execution, and supported compliance | Economic safety, risk scoring, custody, or transaction submission |

The buyer promise is: **do not merely trust an Agent's explanation—inspect what informed the action, who approved its exact boundary, and whether the observed execution stayed within it.** Start with one defined execution route, an identified evidence consumer, explicit assessment and authorization inputs, and a reproducible review of the exported evidence.

## Claim boundaries

- PriorSeal does not construct, sign, or broadcast execution transactions and does not hold transaction-signing keys or funds.
- An Agent ID bound into an authorization identifies the application-declared proposer; it is not a reputation, performance or identity claim unless separately verified.
- A single-use authorization is not a session, budget, recurring or unattended trading mandate.
- Compliance concerns the authorization's supported bound fields. It does not guarantee economic safety, token legitimacy, profitability, or an infallible RPC view.
- Independently confirm issuer keys and the expected audience. Discovery keys packaged with evidence cannot establish their own trust.
- Independent ordering evidence depends on proof mode: RFC 3161, witness quorum, or EVM anchor. Issuer-only acceptance has a narrower scope.
- Some checks, including ERC-1271 account authority and EVM anchor inclusion, require external chain state. Do not describe every proof mode as fully offline.
- External assessment commitments bind evidence digests. They do not prove that an application enforced the assessment or make PriorSeal the issuer of that assessment.
- Preserve pending, unavailable, reverted, and reorg states. A signed receipt can contain explicit non-compliance or uncertainty.

Keep current README, homepage, SEO, API descriptions, SDK introductions, collaboration introductions, and repository About copy consistent with this scope. Preserve protocol identifiers, signed fields, frozen examples, and historical records when updating wording.
