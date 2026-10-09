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

The test plan should also exercise timeout and recovery, a reverted UserOperation, mismatched UserOperation hash, unavailable trace RPC, missing or ambiguous EntryPoint events, and an inclusion block that is replaced by a reorganization. Recovery must never resubmit an operation just because a receipt lookup timed out.

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
