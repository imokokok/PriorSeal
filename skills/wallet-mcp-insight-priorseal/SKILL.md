---
title: "Insight + PriorSeal Guard for Wallet MCP"
description: "A safety workflow for Base Wallet MCP: inspect oracle decision inputs with Insight, bind an eligible exact Base call to an explicit PriorSeal authorization, then retain independently verifiable execution evidence."
name: insight-priorseal-wallet-mcp
version: 0.2.0
---

# Insight + PriorSeal Guard for Wallet MCP

Use this skill only when the user explicitly asks to assess, authorize, or
retain evidence for a Base onchain action with **Insight**, **PriorSeal**, or
both. It is an optional safety layer around Wallet MCP; it is not a wallet,
swap router, price guarantee, or authorization to move funds.

## Required connections

Before a workflow can reach a wallet approval, both services must be available:

1. Wallet MCP (`https://wallet-mcp.coinbase.com`) for wallet discovery,
   EIP-712 signing, `send_calls`, and approval status.
2. Insight MCP (`https://www.oracleinsight.xyz/api/mcp`) for the pre-trade
   safety check and, where applicable, execution-price evidence.

PriorSeal authorization and observation requests use the hosted PriorSeal MCP
at `https://priorseal.xyz/mcp`. A reviewed HTTP client or server-side SDK is a
compatible fallback when the host cannot connect an MCP server. Never place an
API credential, wallet key, or private key in the skill, a prompt, or
browser-side code. Read [the compatibility gate](references/compatibility-gate.md)
before preparing an authorization and [the PriorSeal MCP guide](../../docs/integrations/priorseal-mcp.md)
before connecting a metered Agent account.

Use [`mcp.json`](mcp.json) as a connection template and run
[`examples/connection-check.mts`](examples/connection-check.mts) before the
first integration. It sends only MCP `initialize`, `notifications/initialized`,
and `tools/list`; it never calls a paid tool, asks for a signature, or sends a
transaction. Connection success is not evidence that an action profile is
available: inspect the live tool descriptions and deployment capabilities.

## Wallet MCP onboarding gate

Before using a Wallet MCP write tool, complete Wallet MCP onboarding: confirm
that its tools are connected, obtain a wallet only when needed, and show this
notice verbatim:

> By using the Base MCP, you agree to the [Base Account and Base App Terms of Service](https://wallet.coinbase.com/terms-of-service). Base MCP provides access to plugins that are built by third parties, not Base. Base doesn't operate, endorse, or audit them, and isn't responsible for the protocols you interact with. Transactions are irreversible — always review before approving.

Then load [the Base-call guard plugin](plugins/base-call-guard.md). Do not
invent Wallet MCP parameters: the connected MCP tool descriptions are the
source of truth.

## Non-negotiable safety rules

- An Insight `PASS` or `CAUTION` is advisory risk evidence, not authorization.
  `DANGER` or `BLOCK` means do not prepare, sign, or submit a trade.
- A payment for Insight or PriorSeal is never permission to execute the
  subject transaction.
- The user must approve every Wallet MCP signature and transaction request.
  Present approval URLs and wait for a terminal `get_request_status` result;
  never claim that an action completed before that result.
- Never submit a transaction merely because a PriorSeal authorization was
  accepted. Conversely, never claim an arbitrary Wallet MCP `swap` or batched
  `send_calls` request is covered by PriorSeal unless it passes the
  compatibility gate and every bound byte matches.
- Keep an uncertain, reverted, pending, reorged, or mismatched execution
  explicit. Do not refresh a quote, change calldata, or retry under the same
  authorization.
- Persist a [`Guarded Action` state record](references/guarded-action-states.md)
  after every boundary. `UNKNOWN` may only return to observation of the original
  transaction hash; it can never return to transaction submission.

## Scope and routing

The current full binding profile is intentionally narrow: one Base mainnet
direct EVM call with a concrete transaction envelope, an EOA EIP-712
authorizer/executor, and a terminal canonical transaction hash returned by
Wallet MCP. It excludes Wallet MCP's opaque `swap` path, multi-call batches,
approvals plus swaps, Permit2 signatures, smart-account/UserOperation paths,
and ERC-1271 signatures until each has a separately reviewed PriorSeal
profile and Wallet MCP supplies the exact object to bind.

For an unsupported operation, Insight may still be used as an assessment-only
tool if the user asks. Do not create a PriorSeal authorization or call it a
guarded execution. Explain the boundary briefly and offer a compatible
single-call route or a separate integration review.
