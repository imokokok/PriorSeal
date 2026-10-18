---
title: "Insight + PriorSeal Base Call Guard"
description: "Review a supported Base call with Insight, bind it to explicit PriorSeal authorization, and submit only the exact approved call through Wallet MCP."
name: insight-priorseal-base-call-guard
version: 0.1.0
integration: hybrid
chains: [base]
requires:
  shell: optional
  allowlist: [www.oracleinsight.xyz, priorseal.xyz]
  externalMcp: [wallet-mcp, insight]
  cliPackage: [oracle-insight-guard, priorseal-sdk]
auth: user-provided-service-credential-or-x402
risk: [irreversible, quote-expiry, oracle-risk, unauthorized-execution]
---

# Insight + PriorSeal Base Call Guard

> [!IMPORTANT]
> Complete the Wallet MCP onboarding flow in `SKILL.md` before using this
> plugin. The wallet address is fetched only when an eligible call needs it.

This plugin is a **guard for one already-constructed Base transaction**. It
does not select a protocol, construct a swap route, choose a token, or bypass
the user-facing Wallet MCP approval. It keeps four facts distinct:

```text
Insight assessment → principal authorization → Wallet MCP execution → evidence review
```

## Eligibility gate — stop unless all conditions hold

Before calling PriorSeal, require all of the following. If any item is absent,
stop at assessment-only mode and say which condition is missing.

1. The user expressly requests the guarded/evidence workflow.
2. Wallet MCP reports a Base-mainnet wallet address and the controlling account
   is an EOA able to return a plain EIP-712 signature.
3. A reviewed integration provides one final unsigned Base call:
   `{ chainId: 8453, from, to, data, value, nonce }`.
   `to` is one 20-byte address, `data` is complete `0x` calldata, `value` is
   exact wei, and `nonce` is the EOA transaction nonce that Wallet MCP will
   use. Do not guess a nonce or derive one from a portfolio response.
4. The exact same call, without approvals, batching, simulation-inserted calls,
   a changed fee payer, or reconstruction, can be supplied to Wallet MCP
   `send_calls` as its one-element `calls` array.
5. The post-approval Wallet MCP status contains one canonical Base transaction
   hash. If it returns only a request ID, a UserOperation hash, or a batch
   result, it is unsupported by this profile.
6. Insight can issue a fresh, signed assessment for the proposed action, and
   the assessment has not expired.

This gate deliberately excludes the native Wallet MCP `swap` tool. That tool
does not expose a reviewed final transaction envelope or a binding-compatible
nonce; calling it after an Insight check is not a PriorSeal-guarded execution.

## 1. Inspect the decision input

Call Insight MCP's `pre_trade_safety_check` with the asset, Base chain ID
`8453`, action, trade amount, and—when the integration has it—the reviewed
venue quote / decision-input object. Surface the verdict, freshness, reason
codes, position limit, and signing availability.

- `DANGER` or `BLOCK`: stop. Do not ask Wallet MCP to sign or submit anything.
- Missing Insight attestation: stop the guarded path. An unsigned result may
  inform the user, but cannot be presented as independently verifiable input.
- `PASS` or `CAUTION`: retain the complete assessment bytes and signed
  attestation. Continue only if the user still wants to proceed and the
  eligibility gate holds.

## 2. Prepare a PriorSeal authorization

Use the reviewed PriorSeal HTTP/SDK handoff in
`../references/priorseal-rest-handoff.md`. Build one
`priorseal.intent.v2` exact-call authorization whose chain, sender/executor,
nonce, call target, calldata hash, native value, expiry, and context
commitments match the final transaction envelope. Bind a SHA-256 digest of the
complete Insight signed assessment under its documented Insight namespace; do
not relabel an unsigned assessment as signed evidence.

Before asking for a signature, display a compact review containing:

- network: Base mainnet (8453);
- authorizer and executor address;
- target, native value, calldata hash, nonce, and authorization expiry;
- Insight verdict, signing time, expiry, and key reason codes;
- the statement that approval is single-use and a changed call requires a new
  Insight review and a new authorization.

Reject a server response if its canonical authorization or EIP-712 typed data
does not match the requested account, exact call, expiry, and Insight
commitment.

## 3. Ask the wallet to sign the authorization

Call Wallet MCP's current `sign` tool with the exact EIP-712 typed data
returned by PriorSeal. Present its approval link as **Approve Authorization**.
After the user approves, poll `get_request_status` and use only its completed
signature result. Submit that signature plus the unchanged authorization to
PriorSeal's authorization-acceptance endpoint with a unique idempotency key.

If the wallet returns an ERC-1271 or ERC-6492 wrapper, do not strip or
reinterpret it. Stop and report that this EOA profile does not support the
signature result.

## 4. Submit the exact call once

Recompare the locally retained call with the accepted authorization immediately
before submission. They must agree on `from`, `to`, `data`, `value`, chain and
nonce. Then call Wallet MCP `send_calls` exactly once:

```json
{
  "chain": "base",
  "calls": [{ "to": "<exact target>", "value": "<exact hex wei>", "data": "<exact calldata>" }]
}
```

Present the approval link as **Approve Transaction**. Wait for a completed
status and extract one canonical Base transaction hash. Never automatically
retry. If the user rejects, the status is uncertain, the returned object is not
one Base transaction hash, or any byte differs from the authorization, stop and
retain the authorization as unused/uncertain according to its actual state.

## 5. Observe and verify

Send the canonical transaction hash to PriorSeal's observation endpoint with
the accepted authorization ID. Preserve all returned authorization, acceptance,
observation and receipt bytes. Treat `PENDING`, `REORGED`, `NOT_ASSESSABLE`,
or `NON_COMPLIANT` as explicit outcomes, not a reason to resubmit.

When the transaction is confirmed, use Insight's `execution_receipt` only if
the prior Insight flow supplied its supported execution-certification handle.
Then offer the user the PriorSeal verification bundle and Insight evidence as
separate artifacts. Verify each with its own independently established trust
key; a valid signature does not guarantee profitability or price correctness.

## Supported prompt

> "Use my already prepared single Base call. Check the decision input with
> Insight, ask me to authorize the exact call with PriorSeal, then submit the
> identical call through Wallet MCP and return the evidence status."

## Explicitly unsupported prompts

- “Swap 100 USDC for ETH” through Wallet MCP's native `swap` tool;
- any multi-call approval + action batch;
- Wallet MCP smart-account, UserOperation, session-key, or agent-wallet flow
  that does not expose the exact object required by a separately configured
  PriorSeal profile;
- a transaction whose nonce, exact target/calldata/value, or final transaction
  hash is unknown before the relevant phase.

For these, offer Insight assessment-only mode or request a separately scoped
adapter. Never pretend the generic Wallet MCP confirmation is a PriorSeal
authorization.
