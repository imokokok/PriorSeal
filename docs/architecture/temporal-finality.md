# Temporal evidence and EVM finality

PriorSeal keeps authorization, execution observation, and authorization compliance separate. Time is part of each claim. An authorization carries `notBefore` and `expiresAt`; the execution observation carries the inclusion block number and hash, block timestamp, observation time, confirmation count, and finality state. A v3 receipt signs the authorization and the complete observation.

## Two finality criteria

An intent can sign these optional constraints:

```json
{
  "constraints": {
    "minConfirmations": 3,
    "maxToleratedReorgDepth": 2,
    "finalityRequirement": "RPC_FINALIZED"
  }
}
```

`CONFIRMATIONS` is the default criterion. Under that criterion, `finalityState: "CONFIRMED"` means that the configured confirmation count was reached. It does **not** mean that the consensus protocol finalized the block. Existing signed intents and receipts retain their historical meaning.

`RPC_FINALIZED` is an opt-in criterion. The observer asks the same configured RPC endpoint for the canonical block at the transaction's inclusion height, the observed head block, and the endpoint's `finalized` block. It issues `finalityState: "FINALIZED"` only when the inclusion hash matches the canonical block, the finalized height covers the inclusion height, and the confirmation floor has been reached. An unavailable `finalized` tag leaves the execution `PENDING`; a changed canonical inclusion hash produces `REORGED`. This is an RPC-observed finality claim, not an embedded consensus proof. An offline verifier checks the issuer signature and the internally replayable arithmetic, but must independently trust or corroborate the RPC/issuer claim if that distinction matters to its use case.

`maxToleratedReorgDepth: N` raises the required confirmation count to at least `N + 1`. It is a signed confirmation buffer, not a guarantee that a deeper reorganization is impossible. The effective threshold is the maximum of the request's confirmation count, `minConfirmations`, and `N + 1`. A stricter request can delay confirmation but cannot relax the signed floor. The field is limited to 0–9999; an omitted field adds no buffer. Chain operators should choose the criterion and buffer for their network and risk policy.

A deployment policy can also require `finalityRequirement: "RPC_FINALIZED"` and a minimum `maxToleratedReorgDepth`. Preparation and acceptance reject an intent that omits or weakens those signed constraints. The policy document and its evaluation result remain in the authorized receipt so offline verifiers can replay that admission decision.

## Frozen observation inputs

An included transaction's new observation contains `temporalEvidence` with the criterion, effective confirmation floor, reorg buffer, observed head height, and any RPC finalized block height and hash. Under `RPC_FINALIZED`, it also includes the observed head hash. The signed authorization supplies the expiry and the signed intent constraints. Together with the transaction's inclusion block hash and timestamp, these fields preserve what the observer used at that moment.

The server and SDK offline verifier replay the deterministic checks: the signed criterion and buffer match the observation, confirmation arithmetic matches the frozen head and inclusion heights, and a final outcome satisfies its signed finality criterion. They reject inconsistent or missing temporal evidence for a claimed RPC-finalized execution. They do not refetch historical RPC state during offline verification. A later observation after a reorg creates a distinct signed receipt rather than rewriting the earlier claim.

`PENDING`, `REORGED`, and a final `CONFIRMED`/`REVERTED` observation remain separate. Pending or reorged evidence cannot establish an authorization violation. The finalized criterion changes when execution may be treated as final; it does not by itself prove that an external application actually enforced its decision policy or that an Insight assessment influenced the signer.
