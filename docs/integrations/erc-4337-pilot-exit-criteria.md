# ERC-4337 pilot exit criteria

Use this checklist to decide whether to expand ERC-4337 support beyond the current Base Sepolia Safe4337Module pilot.

## Technical completion

The read-only doctor establishes account, deployment trust, trace-RPC, and bundler readiness. A green result does not prove that a concrete UserOperation has been estimated, signed, submitted, or observed.

Before calling the pilot complete, retain one evidence bundle that demonstrates all of the following:

1. MetaMask is connected to the configured owner on Base Sepolia, and the Safe address, EntryPoint version, target, value, and call data match the reviewed operation.
2. The bundler gas estimate is below the Safe's available native balance, with the maximum fee shown to the owner before signing.
3. The accepted PriorSeal authorization binds the canonical hash of the exact signed UserOperation.
4. The included EntryPoint event matches the UserOperation hash, sender, nonce, result, and gas fields; the Safe observation also verifies the included call and transaction-prestate trust pins.
5. The final PriorSeal observation and receipt are independently verifiable, and the exported evidence bundle contains the operation, authorization, acceptance, observation, and receipt when configured.

The pilot now binds a minimum of two confirmations and a one-block reorg buffer into its authorization, preserves `SUBMITTING` before broadcast, and requires a final matching observation before marking a run complete or exporting evidence. A reverted UserOperation remains a terminal failure record with its actual gas cost; `PENDING` and `REORGED` remain recoverable states.

The regression suite covers recovery after a timed-out/unavailable lookup, a bundler-known pending operation, mismatched UserOperation hashes, a reverted EntryPoint event, missing or duplicate EntryPoint events, unavailable Safe prestate tracing, weak finality, and a changed canonical inclusion block. Recovery never resubmits automatically. A manual retry is available only after the bundler receipt, bundler hash lookup, and EntryPoint event lookup all complete with no result, the Safe nonce and fee checks pass, the user authorizes the exact saved operation again, and the user confirms a separate submission prompt. One retry is permitted; another provider may still hold the operation, so the remaining test-gas risk is shown explicitly.

Run the focused regression tests before treating the recovery behavior as verified. A successful test suite demonstrates handling of controlled provider and observation responses; it does not simulate a live Base Sepolia reorganization or prove that every external bundler has dropped an operation.

Do not describe the current off-chain authorization flow as an on-chain execution gate. If a buyer requires contracts to reject operations without PriorSeal approval, treat that as a separate design requirement and threat-model it before implementation.

## Buyer validation

Interview teams that already execute transactions through smart accounts or automated operators. Ask for one concrete workflow and the evidence they need after execution. Keep product discovery open to three offers:

- **Insight:** risk and decision evidence used independently.
- **PriorSeal:** authorization and execution evidence used independently.
- **Insight + PriorSeal:** decision commitments carried into authorization and verified execution evidence.

For each team, record:

- The person who owns transaction approval and the person who audits the result.
- The account implementation, chain, bundler, and RPC capabilities used today.
- The failure or review gap that costs the team time, money, or control.
- Whether it needs a documented authorization trail, a hard on-chain gate, or both.
- Which of the three offers solves the stated problem and what evidence would justify a pilot.
- The integration owner, security reviewer, and next concrete commitment.

Expand support only when a team can supply a real operation shape and an internal technical owner, and the required evidence fits the current trust model. Add other account decoders only for named buyer demand, with account-specific calldata semantics and independently pinned deployments. Treat bundler, paymaster, batch, and broader chain work as separate scope decisions.
