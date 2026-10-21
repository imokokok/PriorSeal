# PriorSeal first-release product scope

PriorSeal’s core is the independently verifiable relationship between explicit authorization before action and observed EVM or Solana execution afterward. It can be used independently. Insight supplies separate oracle transparency, simulation and risk inputs when the two products are combined. See [product positioning](positioning.md).

PriorSeal 当前可作为受限自动化的付费设计伙伴试点独立交付；公开自助付费
仍受生产 x402 Go/No-Go 约束。详见
[独立商业化就绪度](standalone-commercial-readiness.md)。

PriorSeal 的长期商业方向是 Agent 按调用使用的授权与证据层；当前单次授权
不等同于可重复的自动授权，服务付款也不构成链上行动权限。详见
[Agent usage and payment model](agent-usage-model.md)。

## Primary user

The first release serves Agent builders, wallet and trading-application teams, and treasury engineering teams that need a portable, independently verifiable statement connecting an Agent proposal and a pre-authorized intent to an observed EVM or Solana execution. The end user is the principal who reviews and signs one exact action; the Agent is not given an open-ended asset mandate.

Auditors are the primary evidence consumer. They do not need wallet access and should be able to inspect a downloaded receipt or evidence bundle without trusting the PriorSeal HTTP verification endpoint.

## Core journey

1. Define a bounded EVM intent or compile the bounded Solana transaction message before execution.
2. Have the controlling account sign the canonical EIP-712 authorization or Solana Ed25519 message authorization.
3. Register the authorization and receive a signed acceptance plus independent RFC 3161 timestamp.
4. Observe an explicitly identified EVM transaction or Solana signature against the single-use authorization.
5. Download the v3 receipt and independently recompute authorization, execution status, compliance and signatures.

## Product vocabulary

- **Intent:** an agent proposal until an authorized principal signs it.
- **Authorization:** a principal-signed, time-bounded, audience-scoped, single-use permission delegated to an executor.
- **Timestamp evidence:** a portable DigiCert RFC 3161 token proving the authorization digest existed at the signed UTC time.
- **Observation:** what a configured RPC source returned at a point in time.
- **Receipt:** an issuer-signed observation statement, not an economic guarantee.
- **Local activity:** browser-local convenience data, not a complete server archive.
- **Audit bundle:** a portable export of filtered local evidence and available context; each receipt remains independently verifiable.
- **Review manifest:** original Insight attachments and their byte hashes alongside a native PriorSeal bundle, with explicit verification roles and cross-evidence relationships. It does not issue another authorization or verdict.
- **Project archive:** a credential-scoped store of explicitly uploaded evidence. It is separate from local activity and the public issuance APIs.

## Implemented workflow polish

- The browser imports an already constructed exact EVM call using the SDK's canonical intent builder; transfer and exact-call reports show their different verification scopes.
- `/.well-known/priorseal-agent.json` gives Agent hosts a non-secret machine-readable entry point for capabilities, OpenAPI, MCP, and issuer-key discovery.
- Deployment capability discovery reports profiles, chain configuration, audience, proof mode, and dependencies before wallet signing. Its readiness result describes configuration and storage, not a live RPC/TSA availability guarantee.
- Reviewers can import native bundles or composite manifests and independently confirm reusable trust profiles. Embedded discovery keys cannot approve themselves. Custom audiences and historical key windows are checked.
- SDK authorization checkpoints preserve prepared/signed bytes and an acceptance idempotency key. Observation timeouts return job and transaction recovery handles. Recovery does not broadcast another transaction.
- Optional private uploaded-evidence archives provide project/environment isolation, writer/reviewer roles, immutable supersession history and snapshot pagination. See the [archive runbook](../runbooks/project-evidence-archive.md).
- Rotation diagnostics identify unresolved authorizations without changing the current same-key receipt/acceptance rule.

## First-release success criteria

- A new user can understand and complete the evidence flow in under three minutes when API, RPC and issuer signing are configured.
- Pending, unavailable, reverted, insufficient-finality and reorg states cannot be mistaken for a completed proof.
- Every signed receipt can be downloaded and checked outside the PriorSeal service.
- A valid v3 receipt separately proves the signed evidence and reports whether a final correlated execution complied with the exact canonical intent; in RFC 3161 mode it also proves that an independent TSA timestamped the authorization before the observed block time.
- Product copy consistently states what PriorSeal proves and does not prove.

## Explicit non-goals

- Wallet custody, transaction construction, transaction signing or broadcast.
- Economic safety scoring, token legitimacy guarantees or investment recommendations.
- Agent reputation guarantees, unrestricted delegation, recurring authorization, or autonomous budget spending.
- Treating one RPC provider as an absolute source of truth.
- Presenting browser-local activity as an organizational system of record.

## Later product milestones

- User-account onboarding, SSO and richer project RBAC beyond the implemented credential-scoped uploaded-evidence archive.
- Read-only receipt sharing with revocation/supersession status.
- Policy templates, approval workflows, notifications and webhooks.
- Published CLI distribution and future chain-state adapters for the SDK local verifier.
- Historical ERC-1271 account-state proofs and independently operated transparency witnesses.
