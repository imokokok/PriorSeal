# PriorSeal MCP compatibility proof

This runbook proves the public PriorSeal MCP transport contract without
creating an authorization, an observation, a signature, or a blockchain
transaction. It is deliberately protocol-focused: it does not claim that a
specific product UI will configure every remote MCP server identically.

## What the check proves

`npm run mcp:compatibility:check` sends four JSON-RPC POST requests to
`https://priorseal.xyz/mcp`:

1. `server/discover` using the stateless MCP `2026-07-28` headers and metadata.
2. `tools/list` using the same stateless form.
3. `priorseal_get_capabilities`, validating its stable structured result and
   `mayBroadcastTransaction: false` invariant.
4. `initialize` using the compatible `2025-11-25` handshake.

The check verifies the negotiated protocol response headers, the twelve published
tool names, the read-only and service-state annotations, and both transport
forms. Although MCP uses HTTP POST for these protocol messages, every call in
this check is read-only at the PriorSeal business boundary.

## Run against production

Build the maintained TypeScript operation source and run the proof:

```sh
npm run mcp:compatibility:check
```

For a review environment, pass an HTTPS endpoint explicitly:

```sh
PRIORSEAL_BASE_URL=https://review.example.org npm run mcp:compatibility:check
```

The command prints a JSON record with the endpoint, both negotiated protocol
revisions, tool count, request count, and zero values for business writes,
wallet or transaction signatures, and broadcasts. Treat a non-zero exit as a
failed compatibility claim.

## Release gate

Run this after the Worker deployment and alongside the existing exact-SHA
production smoke check. The proof is suitable for a release gate because it
does not require a credential, modify persistent application state, or incur
an Agent-credit operation. It does not replace independent verification of a
receipt evidence bundle or the synthetic end-to-end authorization smoke test.

## Official MCP Registry publication

The Official MCP Registry stores versioned manifests. When the public MCP
surface changes, publish a new `mcp/server.json` version only after the
matching Worker release is live and this compatibility proof passes against
that deployment. Do not publish an undeployed or unverified endpoint.

For an additive tool, prompt, resource, or compatible option, increment the
minor version; use a major version for a removed/renamed tool or a
client-breaking schema change. Documentation-only changes do not need a
Registry version.

From a networked, authenticated release environment:

```sh
mcp-publisher validate mcp/server.json
npm run mcp:compatibility:check
mcp-publisher publish mcp/server.json
```

The `io.github.imokokok/*` namespace requires the publisher to authenticate
as the repository owner. Confirm that the Registry marks the new version
`active`, that it is returned by the `latest` version query, and that the
public endpoint still passes the read-only proof. Never mark an earlier
version deleted merely because a newer compatible version is available.
