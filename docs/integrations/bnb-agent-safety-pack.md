# BNB Agent Safety Pack

The `bnb-agent-safety` Skill is the distribution layer for a BNB agent that
needs both decision-input evidence and a bounded, verifiable authorization.

## Product boundary

Insight and PriorSeal remain independent products:

- Insight assesses whether the inputs an agent is about to trust are reliable
  enough to continue.
- PriorSeal proves what a principal authorized and whether the observed action
  matched that authorization.

The combined workflow is an integration choice. PriorSeal does not enforce an
Insight verdict unless the host explicitly checks the verdict before signing or
submitting an action.

## Recommended host integration

1. Install the `bnb-agent-safety` skill.
2. Connect Insight and PriorSeal MCP using the included `mcp.json`.
3. Let the wallet/runtime construct the final exact BNB action.
4. Run the narrowest Insight assessment supported by that action.
5. Stop on `BLOCK`, unavailable, or indeterminate evidence.
6. Prepare a PriorSeal authorization with the final call envelope and a
   separate Insight context commitment when required.
7. Show the exact signing payload to the principal and wait for approval.
8. Submit only the exact approved action through the host wallet.
9. Observe the original transaction hash and publish/verify the receipt.

## Distribution targets

The same skill can be placed in MCP-compatible BNB runtimes, Binance Skills
Hub, BNB Agent Studio examples, BAP-578/8004 agent marketplaces, and partner
agent repositories. A host may use Insight alone or PriorSeal alone when the
other layer is outside its scope.

## What this does not claim

- It is not a wallet or execution controller.
- It is not a universal agent reputation score.
- It does not guarantee token, protocol, or trading outcomes.
- It does not add reviewed support for an unsupported BNB protocol.
- It does not turn a service payment or accepted authorization into permission
  to move funds.
