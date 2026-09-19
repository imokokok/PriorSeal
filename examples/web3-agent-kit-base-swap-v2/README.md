# Web3 Agent Kit × Insight × PriorSeal: Base swap v2

This fixture closes the authorization bypass identified during Web3 Agent Kit review. It is a deterministic, synthetic, no-broadcast test of one native ETH → USDC call. It complements, but does not replace, the separate live Base Sepolia run.

## Final authority and mandatory authorization

There is one final agent-side policy decision point: the Web3 Agent Kit governor. Insight supplies signed advisory evidence. The principal supplies transaction authority. PriorSeal records and verifies the principal's exact-call authorization and the observed outcome.

| Component | Role |
|---|---|
| Insight | Signed advisory risk input; never signs or broadcasts the transaction |
| Web3 Agent Kit governor | Applies native policy and maps Insight evidence to a deterministic outcome |
| Principal | Authorizes the exact chain, executor, nonce, call target, calldata hash, value and validity window |
| PriorSeal | Verifies the authorization and records exact-call execution evidence; it does not override the governor |

The v2 composition is fail closed:

- `PASS` plus valid native policy → `PROCEED_TO_PRINCIPAL_AUTHORIZATION`, whether or not native policy separately requests interactive confirmation.
- `CAUTION` → `REQUIRE_PRINCIPAL_CONFIRMATION`, followed by a new exact-call authorization before signing.
- `DANGER`, `BLOCK`, missing, invalid, unknown-key or stale Insight evidence → `DENY`.
- No governor outcome authorizes signing by itself. Every executable path must present a valid principal-signed exact-call authorization.

The historical v1 fixture's `passWithoutNativeConfirmation: ALLOW_EXECUTION` branch is intentionally rejected here. `verify.mjs` pins both PASS branches to `PROCEED_TO_PRINCIPAL_AUTHORIZATION`; a mutation that restores `ALLOW_EXECUTION` fails with `GOVERNOR_AUTHORIZATION_GATE_BYPASS`.

## Generic pre-sign interceptor

The selected integration seam is a generic interceptor after the complete transaction dictionary exists and immediately before the signer is called:

```python
tx = build_transaction(...)
decision = enforcement.assess_and_apply_policy(tx)
authorization = enforcement.require_exact_call_authorization(tx, decision)
signed = enforcement.sign_authorized_transaction(tx, authorization)
```

The interceptor must be an enforced signing API, not only a callback added to `Wallet.sign_transaction()`. At Web3 Agent Kit commit `b673b82e4e90dfc86942fd59533a6b3e5f32598c`, the audit found 24 production `sign_transaction(...)` call expressions and the `Wallet.sign_transaction` definition—25 signer-related positions in total. Nineteen module call sites use the Wallet wrapper, while airdrop, messaging and governance each contain a direct signer path that bypasses it. See [`CALL-SITE-AUDIT.md`](CALL-SITE-AUDIT.md).

The integration therefore needs to migrate all direct signer paths behind one enforced API and add a repository-wide regression check that rejects new direct calls. A hook only inside the existing Wallet method would leave three module bypasses.

## Cost-controlled assessment

Insight's `assessSwap()` is the non-intervening mode: it performs two C3 assessments, one for each asset leg, and returns signed assessment evidence plus a receipt draft/context commitment. It does not request a C4 execution receipt. At the current published unit costs this is 10 credits per assessment cycle. C4 is incurred only when the caller later invokes `verifyAssessedSwapExecution()` or uses the one-shot `executeSwap()` path.

Skipping C4 must never skip principal authorization. A cost-sensitive flow is:

```text
build complete transaction
  → Insight assessSwap() (2 × C3; no C4)
  → governor decision
  → principal exact-call authorization
  → generic pre-sign interceptor
  → broadcast
  → optional verifyAssessedSwapExecution() (1 × C4) when execution evidence is required
```

## Evidence binding

The bundle binds:

- the complete Web3 Agent Kit transaction draft and its deterministic intent ID;
- two signed Insight Oracle Safety Check v3 envelopes and their validity windows;
- the two-leg `insight.pretrade-pair.v1` commitment;
- canonical governor policy and decision digests;
- a principal-signed `priorseal.intent.v2` exact-call authorization; and
- a signed PriorSeal execution receipt with exact-call compliance evaluation.

If submission would occur after either Insight validity window, the rule is `REASSESS_AND_REAUTHORIZE`. The principal authorization cannot outlive the evidence it commits to.

## Reproduce locally

From a PriorSeal checkout:

```sh
npm run generate:web3-agent-kit-base-swap-v2
npm run example:web3-agent-kit-base-swap-v2
```

The verifier runs one positive case and five fail-closed mutations: changed governor decision, restored authorization-bypass policy, changed calldata, revoked historical Insight key and changed observed execution.

Expected result: `status: PASS`, baseline `OK`, and every mutation rejected with its expected reason.

## Boundaries

A passing fixture proves that the exported synthetic objects, signatures, commitments, exact-call authorization and verifier logic reproduce as described. It does not prove a broadcast occurred, that market data was economically correct, that a trade was profitable, that Web3 Agent Kit has adopted the integration, that every future signer implementation is intercepted, or that either product guarantees economic safety. The live Base Sepolia evidence is separately labeled and does not turn synthetic Insight inputs into production-oracle evidence.
