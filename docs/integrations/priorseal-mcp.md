# PriorSeal MCP

PriorSeal exposes a public, remote MCP endpoint at
`https://priorseal.xyz/mcp`. It is a Streamable HTTP server for agents that
need to prepare bounded authorizations, accept a principal-provided signature,
observe a submitted EVM or Solana transaction, and retrieve or verify portable
evidence.

The endpoint supports the current stateless MCP protocol revision
`2026-07-28` and the compatible `2025-11-25` handshake flow. It is listed in
the official MCP Registry as `io.github.imokokok/priorseal`.

For a public adoption guide, use [the MCP integration page](https://priorseal.xyz/integrations/mcp).
For a reproducible, read-only transport proof that checks both protocol forms,
see [the compatibility-proof runbook](../runbooks/mcp-compatibility-proof.md).

## Connect

Configure a remote MCP server with this URL:

```json
{
  "type": "streamable-http",
  "url": "https://priorseal.xyz/mcp"
}
```

MCP does not make an Agent a transaction signer or grant an automatic-trading
permission.

The server exposes these tools:

| Tool | Purpose |
| --- | --- |
| `priorseal_get_capabilities` | Read enabled chains, proof mode, issuer and commercial capabilities. |
| `priorseal_prepare_authorization` | Canonicalize a bounded authorization and return the exact signing payload. |
| `priorseal_prepare_controlled_execution` | Return a prepared authorization, deployment capabilities and the safe handoff sequence for a complete controlled-execution workflow. |
| `priorseal_accept_authorization` | Verify and accept a principal-provided signature. |
| `priorseal_get_authorization` | Read an accepted authorization. |
| `priorseal_observe_execution` | Compare an already-submitted transaction with an authorization. |
| `priorseal_get_observation_job` | Read an automatic finality-observation job. |
| `priorseal_get_receipt` | Read a signed receipt. |
| `priorseal_get_evidence_bundle` | Retrieve the receipt with key-discovery metadata. |
| `priorseal_get_evidence` | Retrieve the chain-neutral Evidence API envelope and its verification bundle. |
| `priorseal_verify_receipt` | Run the deployment's convenience verification endpoint. |

## Agent safety metadata and structured results

Every tool advertises standard MCP annotations. Read-only tools are marked
`readOnlyHint: true` and `idempotentHint: true`. Authorization acceptance and
execution observation are deliberately marked non-read-only but
non-destructive: they can persist a service record and consume configured Agent
credits, yet they never sign, submit, or broadcast a transaction. Those two
operations are not unconditionally idempotent, so callers must send an
`idempotency-key` when their deployment requires replay safety.

Every successful or failed `tools/call` includes a stable
`structuredContent` envelope with this shape:

```json
{
  "schema": "priorseal.mcp.tool-result.v1",
  "tool": "priorseal_prepare_authorization",
  "status": "authorization_prepared",
  "nextAction": "request_principal_signature",
  "requiresHumanSignature": true,
  "mayBroadcastTransaction": false,
  "risk": {
    "level": "human_signature_required",
    "reasonCode": "PRINCIPAL_SIGNATURE_REQUIRED"
  },
  "data": {}
}
```

`data` preserves the original PriorSeal response. Callers should use the
stable outer fields for orchestration and display, and keep the original data
for protocol-specific verification. A successful accepted authorization is not
an execution result; `nextAction: "handoff_exact_authorized_action"` is never
permission to submit a changed, expired, or unmatched transaction. Error
results set `isError: true` and carry a machine-readable error code in
`data.error.code` plus a recovery-oriented `nextAction`.

## Controlled-execution quick start

Use `priorseal_prepare_controlled_execution` when the agent needs the standard
safe sequence rather than an individual primitive. It is read-only: it returns
the prepared authorization, signing payload, live capabilities, and a
`priorseal.controlled-execution-workflow.v1` checklist. The checklist makes
the following boundaries explicit:

1. A human-controlled principal reviews and signs the prepared authorization.
2. The agent accepts that exact signed authorization with an idempotency key.
3. A separate executor may submit only the exact still-valid action.
4. The agent observes the already-submitted transaction and retrieves evidence.

The helper neither accepts the authorization nor submits the transaction. See
[the complete copy-and-adapt example](priorseal-mcp-controlled-execution-example.md).

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

`priorseal_get_evidence` is a delivery view, not a new proof authority. Its
signature status deliberately remains `PRESENT_NOT_VERIFIED` until the caller
verifies the embedded bundle locally with independently pinned issuer-key trust.
