# PriorSeal MCP

PriorSeal exposes a public, remote MCP endpoint at
`https://priorseal.xyz/mcp`. It is a Streamable HTTP server for agents that
need to prepare bounded authorizations, accept a principal-provided signature,
observe a submitted EVM or Solana transaction, and retrieve or verify portable
evidence.

The endpoint supports the current stateless MCP protocol revision
`2026-07-28` and the compatible `2025-11-25` handshake flow. It is listed in
the official MCP Registry as `io.github.imokokok/priorseal`.

## Connect

Configure a remote MCP server with this URL:

```json
{
  "type": "streamable-http",
  "url": "https://priorseal.xyz/mcp"
}
```

The server exposes these tools:

| Tool | Purpose |
| --- | --- |
| `priorseal_get_capabilities` | Read enabled chains, proof mode, issuer and commercial capabilities. |
| `priorseal_prepare_authorization` | Canonicalize a bounded authorization and return the exact signing payload. |
| `priorseal_accept_authorization` | Verify and accept a principal-provided signature. |
| `priorseal_get_authorization` | Read an accepted authorization. |
| `priorseal_observe_execution` | Compare an already-submitted transaction with an authorization. |
| `priorseal_get_observation_job` | Read an automatic finality-observation job. |
| `priorseal_get_receipt` | Read a signed receipt. |
| `priorseal_get_evidence_bundle` | Retrieve the receipt with key-discovery metadata. |
| `priorseal_verify_receipt` | Run the deployment's convenience verification endpoint. |

## Authority and payment boundaries

MCP is only a protocol adapter around the reviewed PriorSeal service. It does
not custody keys, sign for a principal, submit transactions, broaden a signed
intent, or turn a service payment into authority over assets.

`priorseal_prepare_authorization` returns material for a principal-controlled
wallet or signer to approve. An agent must not treat a prepared or accepted
authorization as permission to broadcast a transaction; it must submit only
the exact still-valid action that the principal approved.

Where a deployment has enabled the prepaid Agent credit meter, the MCP
authorization-acceptance and execution-observation calls use the exact same
metered route and idempotency semantics as the REST API. Send
`x-priorseal-agent-key` and `idempotency-key` as request headers for an
enabled metered call. The raw credential belongs in the MCP host's secret
store, never a prompt, source file, or browser application.

Use the downloaded evidence bundle and independently established issuer key
trust for a review decision. The service's `priorseal_verify_receipt` tool is
a convenience check, not an independent trust root.
