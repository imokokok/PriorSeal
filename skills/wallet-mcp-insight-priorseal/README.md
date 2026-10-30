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
5. Run `examples/connection-check.mts` with Node 22+ before the first use. It
   proves only that free MCP discovery is reachable. It does not request a
   wallet signature, call a paid tool, or send a transaction.

`mcp.json` is a credential-free connection template. The server-side integrator
owns its PriorSeal credential and state persistence; the end user never pastes
one into a chat prompt or browser field.

## Guarded Action record

Version 0.2.0 adds the public `priorseal-sdk` `WalletGuardedAction` state model
and a reusable UI card. Persist it at every boundary:

`risk → prepare → authorization signature → accepted → submitted → observe → verify`

`UNKNOWN` is deliberately not a retry state. Re-observe the stored original
transaction hash; do not make a replacement transaction under the same action.
See [`references/guarded-action-states.md`](references/guarded-action-states.md)
and [`docs/integrations/guarded-action.md`](../../docs/integrations/guarded-action.md).

## Release status

The complete, versioned package is also available from
[`priorseal.xyz`](https://priorseal.xyz/downloads/wallet-mcp-insight-priorseal-skill-v0.2.0.zip).
It does not deploy a new PriorSeal endpoint, request Wallet MCP host allowlisting,
or establish a production payment rail. This is a developer-preview integration
package, not a Wallet MCP endorsement or a public commercial-payment launch.
Those are separate operational and partner-authorized changes.
