# Changelog

## 2026-11-05 — capability-gap documentation close-out (P1-3 / P1-5 / P2)

Documentation close-out across the insight and PriorSeal repositories. Every
item below already exists in code; this entry records the capabilities the
README/SDK docs now describe. `insight` has no CHANGELOG.md, so the insight-side
items are recorded here as well.

- **reviewed-profile registry** (insight, `src/lib/reviewed/`): 38 descriptors
  across 8 groups (lending / swap / perp / prediction), a read-only heartbeat
  (`heartbeat.ts`: anchor consistency + activity) and a pure freshness gate
  (`guard.ts`: any non-ACTIVE status → BLOCK). **Status: wired into production
  guard decision paths with EVIDENCE-GRADED enforcement** — only first-hand
  disproved profiles (today just `drift-v2-mainnet`) are hard-BLOCKed by default;
  every other profile is advisory-only, and a `strict` switch (default false,
  reserved until heartbeat infra is ready) BLOCKs all non-ACTIVE profiles.
  `drift-v2-mainnet` is registered `STALE` (P0-1 first-hand check:
  on-chain AMM frozen since 2026-04-01, ~218 days; official repo archived and
  migrated to Velocity; all instructions commented out; constants still
  correct). **Needs manual review registration**: all 38 descriptors carry
  `reviewedAt: 2026-11-05` and most have no captured activity signal
  (activityStatus UNKNOWN → fail-closed STALE).
- **ERC-4626 vault reduction** (insight, `lending/erc4626VaultDecoder.ts` and
  `vaultMarketMapping.ts`): a generic `deposit`/`mint`/`redeem`/`withdraw`
  decoder wired into `baseLendingGuard.ts` **by default**, but the reviewed
  Morpho Blue Base market registry starts **empty and fail-closed** — every
  vault is refused until markets are registered through review or injected as
  `reviewedMarkets`. **Needs manual review registration**: concrete Morpho
  Blue Base `marketId` / `loanAsset` pairs. This is **not** curator-vault
  support.
- **Monad exact-order binding + EIP-712 attestation** (insight,
  `perps/monadPerpGuardAttestation.ts`): binds the canonical `payloadHash` of
  a **centralized Perpl order payload**, not chain calldata, so the
  attestation cannot prove on-chain execution. **Status: lib-layer module +
  tests only, no HTTP verify route and no REST/MCP wiring**; an eligible
  attester key is required to sign. **Needs manual review registration**: the
  Perpl order-payload schema / binding surface and attester-key trust.
- **AUSD independent coverage** (insight, `perps/monadPerpGuard.ts`):
  `requireIndependentAusdCoverage` strict mode is **opt-in, default off**;
  default behaviour is unchanged (insufficient coverage is disclosed, not
  BLOCKed). AUSD has no independent cross-oracle coverage today. **Needs
  manual review registration**: populate the UNVERIFIED AUSD coverage registry
  before strict mode can pass.
- **Prediction entry-chain × settlement-chain mapping** (insight,
  `settlementEvidence/venueChainMapping.ts`): pure offline classification over
  declared metadata, called by `polymarketGuard.ts` **by default**; five venue
  classes, `solana-native` projects are `UNVERIFIED` name-only placeholders,
  `unknown` fails closed. It is one chain-agnostic metadata screen, not four
  per-chain guards and not execution risk control. **Needs manual review
  registration**: first-party program ids / settlement addresses for
  Solana-native venues.
- **Settlement independent re-read** (PriorSeal SDK,
  `settlement-independent-reread.ts`): `independentlyVerifySettlement(
  settlement, { rpcUrl | provider | reader })` uses the caller's own RPC to
  recompute the calldata hash, ERC-20 `Transfer` amounts and chain/block
  against the settlement's claims; `verifySettlementWithIndependentReread`
  composes it with the offline verifier. **opt-in, default off** — with no RPC
  source it returns `UNKNOWN` and never changes existing verifier behaviour.
  Default offline verification stays signature-only and inherits Insight's RPC
  reconciliation claims (`swapTxHash`, `calldataHash`, `fillStatus`, amounts,
  `blockNumber`, `executedPrice`); off-chain quote fields (`executedPrice`,
  `realizedSlippageBps`, `executedAt`) are never independently verifiable.

- **Multichain swap authorization closure** (PriorSeal SDK,
  `insight-base-agent-swap-guard.ts` / `insight-base-agent-swap-guard-settlement.ts`):
  the Base Agent Swap Guard adapter now binds decisions and settlements for
  all three reviewed EVM chains — Base 8453, BNB 56 and Monad 143 — mirroring
  Insight's `SUPPORTED_CHAIN_IDS` and its six reviewed EVM profiles
  (Base 3 / BNB 2 / Monad 1) with a profile→pinned-chain consistency check.
  The intent asset label is chain-aware (`eip155:<chainId>/erc20:<token>`;
  the single-argument form still returns the Base prefix); the EIP-712
  signing domain is unchanged (chainId: 1). Unsupported chains (e.g. 1) and
  profile/chain mismatches fail closed. Tests cover the full 56/143 loop
  (decision → intents → authorization bundle), settlement cross-binding,
  chain-mismatch rejection and cross-chain contradiction detection.

Docs touched by this close-out: `insight/README.md` (capability matrix +
"Scope & non-goals"), `PriorSeal/sdk/README.md` (guard inventory + settlement
re-read boundary). New reports / quickstarts and the rebuilt upper-level report
live outside the repositories under `~/.workbuddy/insight-capability-gap/`.

## Unreleased

## 0.15.0 — 2026-11-03

- Bind Insight settlement closure: verify Insight's signed Base Agent Swap
  Guard settlement offline, cross-bind it to its verified guard decision
  (decisionHash / chain / recipient / guarded swap calldata hash), and detect
  double settlements — one decisionHash closed by two different swap
  transactions. Both settlement cross-checks verify the guard decision itself
  first and fail closed with `DECISION_*` reasons.
- Add the Insight Solana Swap Guard adapter (Orca Whirlpool USDC/USDT):
  Ed25519 decision verification against a pinned key, one reviewed message
  bound into a PriorSeal intent, and closure by Ed25519-verifying the on-chain
  fee-payer signature over the exact attested message bytes
  (`encodeSolanaTransactionMessageBytes` is now exported).
- Add the Insight Hyperliquid Perp Guard adapter: exact unsigned IOC envelope
  validation with binding re-derivation (intentHash, implied notional) and
  EIP-712 decision verification. Builder-fee envelopes fail closed until the
  intent schema carries them.
- Add `priorseal.agent-proposal.v1`: a compact, caller-retained Agent rationale
  record with a canonical SHA-256 context commitment. It binds the retained
  record to the exact authorization intent and the Agent ID in the
  principal-signed authorization. This is a disclosure and evidence binding,
  not a reputation, identity, trading-safety, or investment claim.

## 0.14.0 — 2026-11-03

- Add the Insight Base Agent Swap Guard adapter: offline verification of the
  signed pre-trade decision (EIP-712, key-registry trust), two ordered
  exact-call intents bound to the decision commitment, and a self-contained
  offline reference agent example covering the assess → bind → authorize →
  observe → review loop with fail-closed counterexamples.

## 0.13.0 — 2026-10-19

- Add self-serve funding: `selfServeTopup()` composes an on-chain USDC transfer
  to the deployment payTo, an EIP-191 claim signature from the payer wallet, and
  the new `POST /v1/selfserve/claim` endpoint into one call that returns a meter
  account with payment-backed credits and its one-time credential. The transfer
  callback runs exactly once; claim retries only cover an unseen transaction.
  The deployment must enable the agent meter, an EVM payTo, and Base mainnet
  RPC; discoverability is via `capabilities.payments.selfserveClaim`. An agent
  key remains a credit-spending credential and never carries asset authority.

## 0.12.0 — 2026-10-19

- Bind Insight Decision Input v1 evidence into the review manifest so a trusted-decision swap authorization can carry an independently verifiable decision-input pair next to the exact-call authorization and receipt evidence.
- Derive the default authorization audience from the client `baseUrl` hostname
  instead of the hardcoded `priorseal` default, matching how servers derive
  the audience from their deployment host. An explicit `audience` input still
  wins, and deployments without a `baseUrl` keep the `priorseal` fallback.

## 0.11.1 — 2026-10-17

- Add the published exact-call partner reference and portable v3 verification-bundle path to the SDK documentation. The fixture demonstrates local receipt verification, binding mismatch outcomes, context-commitment comparison, component hashes, and a signature-tamper rejection without an API, wallet, or RPC endpoint.
- Documentation and distribution maintenance release only: exported runtime APIs and SDK runtime dependencies are unchanged from 0.11.0. Repository-level release provenance and dependency controls are maintained separately from the SDK verifier's evidence claims.

## 0.11.0 — 2026-10-15

- Add Solana mainnet-beta authorization and observation for legacy, v0, and v1 compiled transaction messages, including exact message hashing, v0 address lookup resolution, v1 resource configuration, and offline receipt verification.

## 0.10.0 — 2026-10-15

- Add ERC-8004 identity resolution and block-pinned snapshots, canonical agent references, caller-allowlisted registry checks, reputation and validation policy evaluation, context-bound trust-decision bundles, and explicit wallet-based feedback/validation writes. Preserve existing PriorSeal authorization signing bytes.
- Add pinned-block replay for Insight's unsigned V3 risk report and support the single-swap, deadline-enforced SwapRouter02 multicall profile in authorization and review.
- Add offline verification for Insight Decision Input v1 and exact V3 swap evidence, including independent key/policy trust, raw calldata re-decoding, authorized-call binding, and approved router deployment policy.
- Label the local V3 simulation as unsigned advisory evidence and enforce the consumer's signed execution-receipt slippage ceiling during review.

## 0.9.3 — 2026-10-10

- Internal: release-pipeline fix release. Tag `sdk-v0.9.2` was cut for these changes but its publish run failed (workflow packed the wrong package); 0.9.2 was never published to npm. The SDK content is identical to what was dated 0.9.2.

- Fail closed with structured results for malformed Headless market-state pair inputs; require the execution receipt to be issued no earlier than authority time.
- Reject `UNKNOWN`, `HALTED`, and failed feed states regardless of caller status policy. Verify identified historical no-coverage and signed override-reason receipt layouts without treating them as malformed. Add signed negative vectors for receipt ordering, status, feed state, and field-set handling.
- Clarify that `receipt_mode=live` does not establish authentication or payment. These beta verifier changes do not activate a production profile.

## 0.9.1 — 2026-09-30

- Add a reviewed-swap replan comparison that identifies changed signed call fields without granting execution permission.

## 0.9.0 — 2026-09-29

- Replay signed temporal evidence for EVM observations, including the observed head, confirmation floor, reorg buffer, and RPC finalized checkpoint. Reject inconsistent `FINALIZED` claims and enforce signed finality constraints and policy requirements offline.
- Add `finalityRequirement` and `maxToleratedReorgDepth` to intent and capability types. The npm 0.8.0 verifier does not recognize intents using these new constraints; consumers opting in must upgrade.

## 0.8.0 — 2026-09-28

- Add reviewed Uniswap V3 single-pool swap authorization, including exact asset, amount, recipient, router code, fee and deadline binding.
- Ship `priorseal-sdk/defi` as a Node-only package entry with preparation, authorization, durable one-broadcast execution, status and finalized recovery. Keep signer and attempt store under integrator control.
- Pin `verify-insight-receipt` to the verified npm 0.3.1 release and use its shared v1–v5 execution verifier through the existing compatibility entry point. Malformed pair UIDs fail closed.

## 0.7.1 — 2026-09-25

- Improve the SDK README entry path, offline receipt example, expected result, and issuer-key trust guidance. Published runtime files are unchanged from 0.7.0.

## 0.7.0 — 2026-09-21

- Verify compact v2 Merkle transparency checkpoints and Merkle-root EVM anchors
  while retaining historical v1 hash-chain proof support. Issuers need migration
  010 and must roll out this verifier before issuing v2 checkpoints.

- Add sequenced RWA v2 semantic proofs, same-second pairing, receiver eligibility,
  signed fill checks and independent detailed verification axes; preserve v1 vectors.
- Normalize trusted-key ordering without relaxing key revocation or validity checks.
- Pin shared RWA source hashes and frozen vectors in CI. The Node application adds
  a durable authorized execution entry and observation-only recovery (see docs/rwa-hardening.md).

- Add opt-in RWA exact-call commitments and signer-entry guards, including distinct
  authorization-time and execution-time assessments.
- Add combined RWA receipt verification with out-of-band assessment and issuer pins.
- Preserve core receipt/authorization schemas and vendored Insight protocol semantics.

## 0.6.1 — 2026-09-21

- Verify compact v2 Merkle transparency checkpoints and Merkle-root EVM anchors
  while retaining historical v1 hash-chain proof support. This verifier-only
  patch does not enable new receipt issuance or include the optional RWA APIs.

## 0.6.0 — 2026-09-20

- Add exact-call coverage commitments that bind independently verified Insight source and destination report digests into the signed PriorSeal intent.
- Cap authorization expiry to the earliest coverage report expiry and revalidate both reports immediately before provider entry.
- Require caller-owned policy and signer trust pins; unsigned, stale, scope-mismatched, untrusted or insufficient coverage fails before execution.
- Keep coverage evidence optional and external to the core PriorSeal receipt so existing authorization and verification contracts remain unchanged.

## 0.5.0 — 2026-09-19

- Add deployment capabilities and resumable wallet-authorization checkpoints with stable idempotency keys.
- Rebuild EIP-712 signing data locally and verify request, authorization, typed-data, and signer consistency before acceptance. Export `authorizationSigningData` from `priorseal-sdk/verifier` for explicit pre-sign review.
- Permit an expired signed checkpoint to replay acceptance for historical recovery, while explicitly marking it unsuitable for execution.
- Add portable review manifests with original Insight source, destination, and execution attachments. Verify each signature and trust source, both proof UIDs, transaction chain/hash/sender/time, and the exact-call context commitment.
- Support production Insight C4 v5 with its frozen 45-field EIP-712 layout and signed semantic profile. Require independent registry bytes, full SHA-256 and byte length, immutable profile/release objects and consumer-policy admission for a complete combined review.
- Keep legacy C4 review relative to its exact preserved registry snapshot; missing snapshots or unmet release floors remain incomplete. Validate production key roles, revocation windows and both pre-trade timing commitments.
- Keep incomplete external checks, missing artifacts, untrusted signers, and sample trust from producing a fully verified result.
- Load signing verification lazily and ship the verifier's complete declaration dependencies for isolated TypeScript consumers.

Existing evidence formats remain unchanged. Consumers that previously passed inconsistent checkpoints or server-supplied signing layouts now receive an error before wallet signing or acceptance.
