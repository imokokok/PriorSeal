# Base USDC Treasury Pilot Integration

This guide configures one evidence workflow for a customer-controlled Base USDC transfer. It does not submit transactions, custody USDC, or replace organization approval controls.

## Before the pilot

Confirm the following through a trusted deployment channel:

- Base (`8453`) RPC observation is configured and healthy for the intended environment.
- The deployment publishes `priorseal.intent.v1` and Base in `/v1/capabilities`.
- `proofMode` is RFC 3161, witness quorum, or EVM anchor. Do not use `issuer` acceptance as the external pilot's Witness evidence.
- The policy permits the canonical Base USDC asset:
  `eip155:8453/erc20:0x833589fcd6edbe08f4c7c32d4f71b54bda02913`.
- The policy permits the selected executor, recipient, amount, expiry and finality constraints.
- The customer has independently approved the recipient and the operational team knows which wallet or Safe will submit the transfer.

## Run one payment path

1. Open `/app/treasury-pilot` and pass the deployment gate.
2. Select **Start a Base USDC authorization**. The template fixes Base, USDC and `TRANSFER`; enter only the actual atomic amount, executor wallet, recipient, transaction nonce and expiry.
3. Review the canonical authorization returned by `POST /v1/authorizations/prepare`, then sign it with the authorizer wallet. The acceptance is the Witness-stage input; preserve the configured proof evidence.
4. Submit the transfer using the customer's own wallet, Safe, agent or payment system. This is outside PriorSeal.
5. Submit the exact resulting transaction hash to `POST /v1/executions/observe` with the authorization ID. Do not create a new authorization merely because the transaction is pending.
6. Wait for the configured finality result. A final matching result produces a signed receipt; mismatches, reverts, RPC failures and pending states must be retained as such.
7. Export the receipt, establish issuer-key and audience trust through an independent channel, then verify locally in `/app/verify` or with the SDK verifier.

## Reviewer handoff

Give the reviewer the receipt/bundle, the independently obtained issuer key, the expected audience, and the organization-approved payment reference. The reviewer should verify the signature, timeline, authorization binding, Base execution evidence, and compliance result. They must not infer that PriorSeal verified the recipient's identity, internal approval process, or business rationale.

## Stop conditions

Stop the pilot and investigate rather than retrying payment when the policy rejects the intent, Witness evidence is unavailable, the authorization expires, the transaction is ambiguous or reverted, or the receipt is non-compliant. A new authorization is only appropriate for a newly reviewed payment boundary.
