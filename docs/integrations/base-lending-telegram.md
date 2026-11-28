# Base lending Telegram assessment

## Current state

This scenario is not open for user testing. The former Mini App asked users to paste exact transaction JSON and returned a signature bound to calldata. The old Worker endpoint responds `410 Gone`, and the Mini App now shows a stage notice. Do not use archived `/lending` or JSON examples as current test instructions.

## Product direction

The replacement should offer a guided, read-only risk assessment:

1. Let a user enter or select a public wallet address for a current Base position read, where the supported protocol allows it.
2. Separately collect any hypothetical action and post-action values. Label them as user-declared estimates; do not present them as a simulation of protocol execution.
3. Show the assumptions and freshness of on-chain/oracle evidence before assessment.
4. Return a signed assessment bound to those ordinary fields. The result must not include calldata or a transaction/order envelope.
5. Verify the signed result in PriorSeal and explain the decision in ordinary language.

Candidate protocols are Aave V3 Base, Morpho Blue, Compound V3 Base, and reviewed Moonwell markets. Each protocol needs its own input and evidence validation before it is enabled.

## Non-negotiable boundary

No wallet connection, wallet authorization, signature request, transaction construction, submission, relay, or transaction reconciliation is part of the Telegram lending product. A risk verdict, including `ALLOW`, is not an instruction or permission to act. Keep this scene closed until the assessment-only response contract, account linking, user-facing form, per-user billing, and no-charge failure behavior are ready.
