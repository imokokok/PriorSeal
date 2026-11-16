# PriorSeal Guardian: ERC-8004 discovery card

This is the public capability card for the existing PriorSeal ERC-8004 identity
on BNB Smart Chain. It is a service identity for bounded authorization and
independently verifiable execution evidence; it is not a trading agent,
custodian, signer, or universal risk oracle.

## Identity

| Field | Value |
| --- | --- |
| Service label | PriorSeal Guardian |
| Canonical ERC-8004 reference | `eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:376119` |
| Registration file | [`https://priorseal.xyz/.well-known/agent8004.json`](https://priorseal.xyz/.well-known/agent8004.json) |
| Registration transaction | [`0x5c5bc79f2600e2c7dd2a28318e84a7fd66e7d42ebc7fdd47fa291829eb15`](https://bscscan.com/tx/0x5c5bc79f2600e2c7dd2a28318e84a7fd66e7d42ebc7fdd47fa291829eb15) |
| MCP endpoint | [`https://priorseal.xyz/mcp`](https://priorseal.xyz/mcp) |
| OpenAPI | [`https://priorseal.xyz/openapi/v1.json`](https://priorseal.xyz/openapi/v1.json) |
| Integration manifest | [`https://priorseal.xyz/.well-known/priorseal-agent.json`](https://priorseal.xyz/.well-known/priorseal-agent.json) |
| Public MCP registry entry | `io.github.imokokok/priorseal` |

The ERC-8004 identity is named `PriorSeal` in the on-chain registration file.
`PriorSeal Guardian` is the service label used for discovery and positioning;
it does not create a second identity or imply a second wallet.

## Supported checks

PriorSeal produces operation-specific evidence. A caller supplies the action,
principal, executor, policy and trust inputs; PriorSeal does not infer a
universal score.

| Check | What is bound or observed | Typical result |
| --- | --- | --- |
| Agent identity | Registry, chain, agent ID, registered `agentWallet` and expected executor | `MATCH` or fail-closed mismatch |
| Bounded authorization | Exact action, target, calldata/value, nonce, validity window, principal signature and policy hash | `authorization_prepared` / accepted or rejected |
| Execution correlation | Chain, sender, nonce, transaction, receipt, block and finality evidence | `COMPLIANT`, `NON_COMPLIANT` or `NOT_ASSESSABLE` |
| Transfer evidence | Native-value envelope and verified ERC-20 `Transfer` logs where configured | Included in the signed receipt |
| Portable verification | Issuer key, signature, bundle hash, evidence continuity and optional timestamp/witness data | Independently verifiable receipt bundle |
| Fresh evidence | Read-only re-observation of an existing transaction | New signed evidence check; never execution authority |

Insight can supply decision-input evidence before the authorization step. When
the two products are composed, the Insight evidence commitment is included in
the PriorSeal authorization context so the reviewed decision and the executed
action remain linked.

## MCP tools

The remote MCP server exposes the following discovery and workflow surface:

- `priorseal_get_capabilities`
- `priorseal_prepare_authorization`
- `priorseal_prepare_controlled_execution`
- `priorseal_accept_authorization`
- `priorseal_get_authorization`
- `priorseal_observe_execution`
- `priorseal_get_observation_job`
- `priorseal_get_receipt`
- `priorseal_get_evidence_bundle`
- `priorseal_get_evidence`
- `priorseal_get_fresh_evidence_check`
- `priorseal_verify_receipt`

The MCP server never requests a transaction-signing key, signs for the
principal, broadcasts a transaction, or turns service payment into asset
authority. See the [MCP integration guide](priorseal-mcp.md) for annotations,
structured results and the controlled-execution example.

## Typical evidence

The repository contains deterministic examples for both successful and failed
verification. They are deliberately fixtures, not claims about a customer's
live transaction:

- [Matching exact-call receipt](../../examples/thoughtproof-sentinel-paired-v2/priorseal-receipt-matching.json)
- [Calldata mismatch](../../examples/thoughtproof-sentinel-paired-v2/priorseal-receipt-calldata-mismatch.json)
- [Executor mismatch](../../examples/thoughtproof-sentinel-paired-v2/priorseal-receipt-executor-mismatch.json)
- [Expired decision](../../examples/thoughtproof-sentinel-paired-v2/priorseal-receipt-decision-expires-first.json)
- [Open evidence lab](../../examples/open-evidence-lab-exact-call-matrix-v1/README.md)

For a live receipt, the public API exposes the receipt and portable bundle only
after the relevant authorization and execution have been observed:

```text
GET https://priorseal.xyz/v1/receipts/{receiptId}
GET https://priorseal.xyz/v1/evidence/receipts/{receiptId}
GET https://priorseal.xyz/v1/receipts/{receiptId}/bundle
```

## Commercial boundary

- Discovery and capability inspection are public and read-only.
- Paid receipt-bundle, evidence-envelope and fresh-check exports use the
  deployment's x402 configuration.
- The current public registration advertises `0.02 USDC` per receipt-bundle
  request on the configured networks; callers must use the live OpenAPI/x402
  challenge as the source of truth.
- Payment purchases evidence delivery only. It never authorizes a subject-chain
  transaction.

## Failure cases and non-claims

The service fails closed or reports `NOT_ASSESSABLE` when the identity,
executor, target, calldata, value, nonce, time window, finality or evidence
does not match the authorized action. Pending RPC results, provider timeouts,
reorgs and missing evidence are not converted into a positive decision.

PriorSeal does not claim to detect every malicious contract, guarantee a token's
economic value, certify an agent's general reputation, or replace the buyer's
own trusted-registry, RPC, wallet and policy configuration.

## Integration references

- [ERC-8004 identity and accountability](erc-8004.md)
- [PriorSeal MCP](priorseal-mcp.md)
- [Chain capability and identity record](../architecture/chain-capabilities.md)
- [Decision-input evidence](../evidence/decision-input-evidence-alignment.md)
- [Insight](https://www.oracleinsight.xyz/)
