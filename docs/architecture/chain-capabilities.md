# Chain capability matrix

PriorSeal treats payment, authorization, execution observation, and external
anchoring as separate capabilities. A chain appearing in one column is not an
implicit claim that every other column is enabled.

## Production-aligned execution and payment rails

| Chain | CAIP-2 payment rail | Generic execution observation | Notes |
|---|---|---|---|
| Ethereum | `eip155:1` | Yes | EVM JSON-RPC, deployment RPC required. |
| OP Mainnet | `eip155:10` | Yes | EVM JSON-RPC, deployment RPC required. |
| Polygon PoS | `eip155:137` | Yes | EVM JSON-RPC, deployment RPC required. |
| Monad | `eip155:143` | Yes | Offered only when the selected facilitator supports `exact`. |
| Sei | `eip155:1329` | Yes | EVM JSON-RPC, deployment RPC required. |
| X Layer | `eip155:196` | Yes | EVM JSON-RPC, deployment RPC required. |
| BNB Smart Chain | `eip155:56` | Yes | EVM JSON-RPC, deployment RPC required. x402 settles 18-decimal bridged USDC through a facilitator with a non-EIP-3009 mandate flow (AEON; set `PRIORSEAL_X402_FACILITATOR_URLS`). |
| Base | `eip155:8453` | Yes | EVM JSON-RPC, deployment RPC required. |
| Arbitrum One | `eip155:42161` | Yes | EVM JSON-RPC, deployment RPC required. |
| Avalanche C-Chain | `eip155:43114` | Yes | EVM JSON-RPC, deployment RPC required. |
| Solana mainnet-beta | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | Yes | x402 `exact` SPL USDC payment; PriorSeal authorizes and compares the complete compiled transaction message. |

Base Sepolia (`eip155:84532`) remains an observation and integration-test chain;
it is deliberately not a production payment rail.

## ERC-8004 agent identity

PriorSeal is registered on the BNB Smart Chain Identity Registry
(`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) as **agentId 376119**
(registration tx `0x5c5bc79f2600e2c7dd2a28318e84a7fd66e7d42ebc7fdd47fa291829eb15`,
block 1228378614, 2026-10-18). The token URI points at
`https://priorseal.xyz/.well-known/agent8004.json`, which declares the OpenAPI
surface and the x402 payment rails (`eip155:8453` + `eip155:56`, exact v2
USDC). Owner and agent wallet: `0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231` —
the same registrar wallet holds Insight's ERC-8004 identity (agentId 375779),
so the two products are discoverable side by side through the same registry.
Re-register or update via `npm run agent8004:register`; the registrar key
lives only in `.env.local`.

“Generic EVM observation” means PriorSeal validates the RPC chain identity and
records the transaction, receipt, block, native transfer envelope, and verified
ERC-20 `Transfer` logs. A deployment must configure the corresponding
`PRIORSEAL_RPC_*` value. Empty configuration does not become a guessed public
endpoint or a positive readiness claim.

Production and staging x402 payment availability is additionally bounded by
the explicit `PRIORSEAL_X402_NETWORKS` allowlist. The implementation supporting
a row in this table is not itself an activation of that payment rail; see the
[x402 staging rollout runbook](../runbooks/x402-staging.md).

## Explicitly separate advanced profiles

ERC-4337, Safe 4337, and EIP-7702 are **not** enabled merely because a chain
appears above. Each deployment must separately pin the EntryPoint, module,
delegate, proxy/singleton, and runtime code hashes as applicable. Solana support
does not decode arbitrary program semantics: it binds the compiled message and
observes the confirmed transaction.

## Payment versus the subject execution

An x402 buyer may pay in any configured and facilitator-supported payment rail
for a PriorSeal service about a transaction on another chain. Payment evidence
therefore carries its own `payment.requirement.network`; execution receipts
retain their independently authorized subject chain. Consumers must not infer
that the payment network settled or executed the subject action.
