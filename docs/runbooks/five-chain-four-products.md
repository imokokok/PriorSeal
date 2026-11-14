# Five-chain Seal / Witness / Match / Review release gate

This runbook is the release gate for Base, BNB Smart Chain, Solana mainnet-beta,
HyperCore and HyperEVM. It turns the common four-product vocabulary into
per-network evidence without treating an x402 payment rail, chain ID, or
configuration file as proof that a workflow is production-ready.

## Scope

| Network | Permitted first-release Match profile |
|---|---|
| Base | Generic EVM transfer or exact call |
| BNB Smart Chain | Generic EVM transfer or exact call |
| HyperEVM | Generic EVM transfer or exact call |
| Solana mainnet-beta | Complete legacy, v0, or v1 compiled transaction message |
| HyperCore | `priorseal.execution-profile.hyperliquid-spot-ioc.v1` only |

Do not claim ERC-4337, Safe, EIP-7702, arbitrary Solana program semantics,
HyperCore perpetuals, vaults, API wallets, withdrawals, or general Hyperliquid
support through this gate.

## Stage 0 — review the release policy and dependencies

Start from
[`config/authorization-policy.five-chain.example.json`](../../config/authorization-policy.five-chain.example.json).
It is an example and is **not** an authorization to replace the deployed policy.
Review the exact action/asset/recipient limits with the customer and security
owner before installation.

For the runtime, configure and validate independently reviewed endpoints for:

- `PRIORSEAL_RPC_BASE`, `PRIORSEAL_RPC_BNB`, and `PRIORSEAL_RPC_HYPEREVM`;
- `PRIORSEAL_RPC_SOLANA_MAINNET`;
- `PRIORSEAL_HYPERLIQUID_ENABLED=true` plus an explicit
  `PRIORSEAL_HYPERLIQUID_INFO_URL`; and
- production `PRIORSEAL_PREEXECUTION_PROOF_MODE=rfc3161` with the approved TSA
  dependency.

The deployment's capability response must list all five networks in
`fourProductCoverage`. Each record must report `Seal: configured`,
`Witness: configured` with `mode: rfc3161`, `Match: configured`, and
`Review: configured`. This report confirms declared configuration only; run the
remaining stages before a public claim.

## Stage 1 — chain-by-chain controlled evidence

For every network, obtain an explicit, capped authorization for one controlled
action. Preserve the raw request/response facts immediately. Do not repeat an
unknown submission, and do not use a customer wallet merely to make this gate
green.

For Base, BNB, and HyperEVM, retain:

1. EIP-712 authorization and acceptance;
2. RFC 3161 token predating the observed block;
3. transaction, receipt, block and observed transfer/call facts;
4. a `COMPLIANT` signed receipt and locally verified bundle; and
5. one altered nonce, calldata, target, value, or transaction test that becomes
   non-compliant or not assessable rather than silently passing.

For Solana, run the same sequence using an Ed25519 authorization and include
the full compiled message. Cover legacy, v0-with-lookup-tables, and v1 before
advertising all three variants.

For HyperCore, follow the dedicated HyperCore evidence requirements in the
[integration guide](../integrations/hyperliquid.md#five-chain-release-evidence).

## Stage 2 — independent Review

For each resulting receipt, verify the bundle in a separate environment with a
separately trusted issuer public key. Record the verifier version, bundle hash,
receipt ID, result code, execution status and compliance status. Verify that an
Evidence API envelope has the expected profile:

- `priorseal.evidence-profile.evm.v1` for Base, BNB, HyperEVM;
- `priorseal.evidence-profile.solana-transaction.v1` for Solana; and
- `priorseal.evidence-profile.hyperliquid-spot-ioc.v1` for HyperCore.

## Stage 3 — approve activation separately

Only after Stages 0–2 pass may the release owner approve an update to the
deployed policy and runtime configuration. That approval must name the chain,
profile, RPC provider, maximum value, wallet, route and rollback/kill switch.
For HyperCore, `PRIORSEAL_HYPERLIQUID_ENABLED=false` is the immediate profile
kill switch. For each EVM/Solana chain, remove the chain/action from the policy
or withdraw its RPC endpoint to fail closed.

Store the completed evidence packs in the protected project archive or another
approved evidence store; do not put customer data, wallet credentials, or raw
provider credentials in Git.
