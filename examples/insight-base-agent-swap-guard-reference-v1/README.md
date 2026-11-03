# Insight Base Agent Swap Guard reference v1

A self-contained, synthetic reference agent that drives Insight's
`prepare_base_agent_swap_guard` composition through PriorSeal's
base-agent-swap-guard SDK adapter:

1. **assess** — one signed, short-lived Insight `ALLOW`
   (`insight.base-agent-swap-guard-decision.v1`) for one exact ERC-20 approval
   and one exact direct-router swap on Base.
2. **bind** — two ordered exact-call intents (approval at nonce `N`, swap at
   `N + 1`) built with `buildBaseAgentSwapGuardBoundIntents`, each carrying the
   `insight.base-agent-swap-guard.v1` context commitment of the decision hash.
3. **authorize** — the principal signs each exact-call authorization
   separately (EIP-712, adjacent nonces, shared expiry capped to the decision).
4. **observe** — the approval is observed before the swap is used; each
   observed call yields one signed PriorSeal v3 receipt.
5. **review** — a reviewer verifies both receipts plus the original signed
   Insight decision offline through `verifyBaseAgentSwapGuardReceiptBundle`,
   including fail-closed counterexamples.

This is a **reference fixture**, not a live run: no RPC endpoint, hosted
service, funded wallet, private credential, or real transaction is used. The
signing material is deliberately public and deterministic TEST material.

## Run from a fresh checkout

Node.js 22 or later is required.

```sh
npm ci
npm run sdk:build
npm run core:build
node examples/insight-base-agent-swap-guard-reference-v1/generate-fixtures.mjs
node examples/insight-base-agent-swap-guard-reference-v1/verify.mjs --update
node examples/insight-base-agent-swap-guard-reference-v1/verify.mjs
```

The final run must print `"result": "PASS"`. The committed `report.json` is
the machine-readable review record; a plain `verify.mjs` run recomputes every
check and every fixture hash and rejects any drift.

## What the reviewer proves

- the Insight decision's integrity hash, both calldata hashes, recipient,
  chain, verdict, and ≤120 s expiry are internally consistent and signed by a
  pinned Insight attester key;
- both intents are the only calls the decision authorizes, in approval-then-
  swap order with adjacent nonces and a shared expiry that never outlives the
  decision;
- both authorizations are principal-signed with the decision commitment, and
  neither authorization outlives the decision (the `outlives` counterexample
  is rejected);
- both receipts are signed by the pinned PriorSeal issuer and bind observed
  executions to their authorizations, with the approval observed before the
  swap; a tampered receipt is rejected.

## Scope boundary

This fixture covers the two current Insight Base direct-call profiles
(Aerodrome Slipstream WETH→USDC CL100 and PancakeSwap V3 USDC→USDT 0.01%).
It does not cover aggregators, permits, native input, multicalls, smart
accounts, or any automatic execution authority. A live mainnet recorded run
requires a named maximum-spend route and an explicit per-bundle GO under the
partner joint-run playbook.
