# Wallet MCP × Insight × PriorSeal

The [`wallet-mcp-insight-priorseal` skill](../../skills/wallet-mcp-insight-priorseal/README.md)
is the Wallet MCP companion for Insight decision-input integrity and PriorSeal
authorization/execution evidence on Base.

Download the complete installable package from
[`priorseal.xyz`](https://priorseal.xyz/downloads/wallet-mcp-insight-priorseal-skill-v0.1.0.zip).
The source directory in this repository is canonical; the download contains only
that directory's Markdown files and no executable code or credentials.

It intentionally supports only one final Base EOA exact call. Wallet MCP's
generic swap interface, multi-call batches, smart-account UserOperations and
contract-wallet signature wrappers are not silently interpreted as an exact
PriorSeal call. The skill returns to assessment-only mode when a binding cannot
be established. This boundary is security behavior, not an incomplete fallback.

The user approves two distinct Wallet MCP requests:

1. an EIP-712 signature for the exact PriorSeal authorization; and
2. the matching onchain call.

Insight assessment, service payment, wallet signature and execution
authorization remain separate facts. See the package's
[compatibility gate](../../skills/wallet-mcp-insight-priorseal/references/compatibility-gate.md)
and [REST handoff](../../skills/wallet-mcp-insight-priorseal/references/priorseal-rest-handoff.md)
for the full protocol.
