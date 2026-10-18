# Insight + PriorSeal Guard for Wallet MCP

This is an installable companion skill for Coinbase Wallet MCP (formerly Base
MCP). It makes a narrow claim: for an eligible single Base EOA call, it
orchestrates Insight decision-input evidence, an explicit PriorSeal EIP-712
authorization, Wallet MCP's two user approvals, and post-execution evidence.

It deliberately does **not** claim that Wallet MCP's generic `swap`, a batch,
or a smart-account request is covered by PriorSeal. See
[`references/compatibility-gate.md`](references/compatibility-gate.md).

## Install

1. Connect Wallet MCP at `https://wallet-mcp.coinbase.com`.
2. Connect Insight MCP at `https://www.oracleinsight.xyz/api/mcp` and configure
   its normal API-key or x402 access.
3. Add this directory as a local skill to the chosen agent surface. It is a
   self-contained skill package: `SKILL.md` is the entry point and the plugin
   is loaded only when the user explicitly asks for an Insight/PriorSeal-guarded
   Base action.
4. Use a reviewed server-side or CLI adapter for PriorSeal REST calls. Consumer
   chat surfaces that cannot call the authenticated PriorSeal API can use the
   Insight assessment portion, but must stop before authorization and never
   claim a guarded execution.

## Release status

The complete, versioned package is also available from
[`priorseal.xyz`](https://priorseal.xyz/downloads/wallet-mcp-insight-priorseal-skill-v0.1.0.zip).
It does not deploy a new PriorSeal endpoint, request Wallet MCP host allowlisting,
or establish a production payment rail. Those are separate operational and
partner-authorized changes.
