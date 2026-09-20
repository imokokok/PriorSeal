# Insight + PriorSeal RWA adaptation — implementation and acceptance plan

执行状态（2026-09-20）：下列六个阶段已完成本地实现与验收。生产 RWA 数据、
签名服务和客户启用仍保持关闭；详见 [中文验证结论](rwa-validation.md)。

## Objective and compatibility

Deliver an opt-in RWA / tokenized-equity assessment and authorization workflow. Insight remains independently usable for assessments; PriorSeal remains independently usable with customer-selected signed assessments; their combination binds the assessment to an exact EVM call. Existing crypto pricing, Watch, pre-trade schemas, coverage policies, partner activations, receipts, and authorization behavior retain their current semantics.

## Implementation scope

1. **Instrument identity and quote semantics.** Content-address a descriptor containing underlying identifier, issuer, token contract and settlement chain, venue MIC, asset kind, quote currency, price basis and corporate-action version. Feed admission belongs to consumer-pinned policy. Different issuers, underlying spot prices, token NAVs and secondary-market token prices must not be silently pooled.
2. **Deterministic operation policy.** Buy, sell, borrow, collateralize, liquidate and redeem have explicit session, freshness, spread and evidence requirements. Repayment can be explicitly price-independent. Missing/unknown market, instrument halt, corporate-action, reserve or eligibility information never becomes affirmative evidence. Reserve and eligibility requirements are configurable for the workflow, not claims that Insight performs custody audits or KYC.
3. **Portable assessment.** New `insight.rwa-report.v1` EIP-712 family; immutable policy and instrument hashes; exact transaction scope; bounded validity; recomputable evaluation; consumer-pinned signer validity and environment. Inputs are assertions of the assessment signer, not automatically verified provider signatures. No public route signs arbitrary caller-supplied observations with the production key.
4. **Provider adapters and consumer surfaces.** Normalize on-chain Chainlink rounds and decoded Chainlink v11 mid-price timestamps and phases; carry separate instrument-halt evidence; preserve unknowns. Expose local SDK evaluation and an authenticated, unsigned HTTP diagnostic for supplied evidence. Do not activate paid feeds or claim that decoded reports have been authenticated. Publish machine-readable input schema and a typed SDK client.
5. **PriorSeal composition.** Build an exact-call intent with the report commitment, restrict authorization lifetime to the evidence lifetime, recheck immediately before callback entry, and verify a distinct execution-time assessment against the same request and policy. Verify the principal authorization / transaction correlation with the existing PriorSeal verifier separately; a context hash is not authority.
6. **Runnable use and verification.** A local joint example imports the actual built Insight and PriorSeal SDKs, signs only with a public fixture key, tests a normal authorized call and a changed market state, and emits explicit simulation labels. Adversarial tests cover wrong instrument, quote basis, source groups, future/stale observations, closed/unknown sessions, halts, corporate actions, reserve/eligibility, tampering, signer trust, replay scope and evidence expiration. Run existing regression suites, type checks and protocol guards.

## Acceptance and release boundary

- Both independent SDK usage and the joint workflow must run without modifying existing consumers.
- Old tests stay enabled. No tests/thresholds are weakened to accommodate RWA.
- No historical signed schema, immutable policy or partner activation is rewritten.
- A successful simulation proves implementation behavior, not production market coverage, stock backing, legal ownership or a live trade.
- Production activation requires real contracted data, reviewed instrument/policy definitions, admitted signer keys, operating runbooks and deployment. This implementation does not silently publish packages, deploy services, buy data or trade.

## Data references

- https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide — phases, mid timestamp scope, separate halt limitations, session boundaries.
- https://ondo.finance/ondo-stocks — mint/redemption pauses and issuer-specific token behavior.

## Delivery record

Implementation results, commands, failures and remaining production prerequisites are recorded in `rwa-validation.md` after verification.
