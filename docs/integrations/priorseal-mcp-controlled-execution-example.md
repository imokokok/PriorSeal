# PriorSeal MCP controlled-execution example

This example is a safe integration pattern for an agent that proposes a Base
action, asks its principal to sign the exact bounded authorization, and later
collects independently verifiable evidence. It is a workflow example, not
authority for a client to sign or broadcast on a user's behalf.

## 1. Connect the remote server

```json
{
  "type": "streamable-http",
  "url": "https://priorseal.xyz/mcp"
}
```

If the deployment meters acceptance or observation, configure the Agent
credential in the MCP host's secret store. Never put it in a prompt, source
file, or browser application.

## 2. Prepare the complete safe handoff

Call `priorseal_prepare_controlled_execution`. Replace every example identity,
address, nonce, amount, and expiry with the independently reviewed values for
this action. `validUntil` must be a future Unix timestamp and should be short
enough for the intended review window.

```json
{
  "input": {
    "intent": {
      "schema": "priorseal.intent.v2",
      "intentId": "base-transfer-2026-10-18-001",
      "chainId": 8453,
      "action": "TRANSFER",
      "asset": "eip155:8453/native",
      "amount": "1000000",
      "sender": "0x1111111111111111111111111111111111111111",
      "recipient": "0x2222222222222222222222222222222222222222",
      "validUntil": 1800000000,
      "nonce": "0"
    },
    "principal": {
      "type": "user",
      "id": "reviewed-principal-id",
      "account": "0x1111111111111111111111111111111111111111"
    },
    "authorizer": {
      "type": "eip712",
      "address": "0x1111111111111111111111111111111111111111"
    },
    "delegate": {
      "agentId": "reviewed-agent-id",
      "executor": "0x3333333333333333333333333333333333333333"
    },
    "issuedAt": 1790000000,
    "expiresAt": 1800000000,
    "authorizationNonce": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "maxUses": "1"
  }
}
```

The stable outer result must report all of the following before the agent asks
for a signature:

```json
{
  "status": "controlled_execution_prepared",
  "nextAction": "request_principal_signature",
  "requiresHumanSignature": true,
  "mayBroadcastTransaction": false
}
```

The original authorization and EIP-712 typed data (or Solana signing message)
are in `structuredContent.data`. Display the exact fields to the principal and
do not substitute any field after review.

## 3. Continue only after the principal signs

Send the completed, unchanged authorization to
`priorseal_accept_authorization`. Supply `idempotency-key`; if the deployment
advertises Agent credits, also supply `x-priorseal-agent-key` from the MCP
host's secret store. A successful result means the authorization was recorded,
not that a transaction ran.

Only a separate execution component may submit the exact, still-valid action
that matches the signed authorization. A changed amount, recipient, calldata,
principal, executor, nonce, chain, or expiry requires a new authorization.

## 4. Observe and independently verify evidence

After a transaction is already submitted, call
`priorseal_observe_execution` with the authorization identifier and transaction
identity. If it returns `observation_queued`, poll
`priorseal_get_observation_job`; otherwise review its receipt. Retrieve the
portable bundle with `priorseal_get_evidence_bundle` and verify it locally
against independently established issuer-key trust. The convenience
`priorseal_verify_receipt` result is not an independent trust root.
