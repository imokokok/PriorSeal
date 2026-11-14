# Chain capability matrix

PriorSeal treats payment, authorization, execution observation, and external
anchoring as separate capabilities. A chain appearing in one column is not an
implicit claim that every other column is enabled.

## Seal / Witness / Match / Review coverage

The product vocabulary is deliberately separate from payment rails:

- **Seal** — the principal's bounded authorization before an action;
- **Witness** — independent pre-execution time/order evidence;
- **Match** — comparison of an observed execution with the signed boundary;
- **Review** — portable receipt, bundle, and independent verification path.

`GET /v1/capabilities` exposes `fourProductCoverage` for every network that
the deployment actually advertises. It is a configuration report, not a live
RPC/TSA/venue availability guarantee. A payment rail never fills a missing
Seal, Witness, Match, or Review stage.

The intended five-chain release scope is:

| Network | Seal | Witness | Match | Review | Deliberate boundary |
|---|---|---|---|---|---|
| Base (`eip155:8453`) | EIP-712; optional ERC-1271 | RFC 3161 | EVM receipt, transfer logs and exact-call envelope | EVM bundle and Evidence API profile | ERC-4337/Safe/EIP-7702 remain separately pinned profiles. |
| BNB Smart Chain (`eip155:56`) | EIP-712; optional ERC-1271 | RFC 3161 | EVM receipt, transfer logs and exact-call envelope | EVM bundle and Evidence API profile | The ERC-8004 registry entry is discovery only, not execution evidence. |
| HyperEVM (`eip155:999`) | EIP-712; optional ERC-1271 | RFC 3161 | EVM receipt, transfer logs and exact-call envelope | EVM bundle and Evidence API profile | No HyperEVM-specific account or finality semantics are inferred. |
| Solana mainnet-beta | Ed25519 message authorization | RFC 3161 | Complete compiled transaction message | Solana bundle and Evidence API profile | No arbitrary-program semantic or token-balance interpretation. |
| HyperCore (`hyperliquid:mainnet`) | EIP-712 authorization for the bounded order | RFC 3161 | HyperCore spot IOC cloid/status/fill matching | HyperCore spot-IOC bundle and Evidence API profile | Spot IOC only; it is not HyperEVM or general Hyperliquid support. |

Use the [five-chain release gate](../runbooks/five-chain-four-products.md)
before adding any of these networks to an active production authorization
policy.

## Production-aligned execution and payment rails

| Chain | CAIP-2 payment rail | Generic execution observation | Notes |
|---|---|---|---|
| Ethereum | `eip155:1` | Yes | EVM JSON-RPC, deployment RPC required. |
| OP Mainnet | `eip155:10` | Yes | EVM JSON-RPC, deployment RPC required. |
| Polygon PoS | `eip155:137` | Yes | EVM JSON-RPC, deployment RPC required. |
| Monad | `eip155:143` | Yes | Offered only when the selected facilitator supports `exact`. |
| HyperEVM | `eip155:999` | Yes | Native Circle USDC; configure `PRIORSEAL_RPC_HYPEREVM` for observation. x402 is offered only when the selected facilitator supports `exact`. |
| Sei | `eip155:1329` | Yes | EVM JSON-RPC, deployment RPC required. |
| X Layer | `eip155:196` | Yes | EVM JSON-RPC, deployment RPC required. |
| BNB Smart Chain | `eip155:56` | Yes | EVM JSON-RPC, deployment RPC required. x402 settles 18-decimal bridged USDC through a facilitator with a non-EIP-3009 mandate flow (AEON; set `PRIORSEAL_X402_FACILITATOR_URLS`). |
| Base | `eip155:8453` | Yes | EVM JSON-RPC, deployment RPC required. |
| Arbitrum One | `eip155:42161` | Yes | EVM JSON-RPC, deployment RPC required. |
| Avalanche C-Chain | `eip155:43114` | Yes | EVM JSON-RPC, deployment RPC required. |
| Solana mainnet-beta | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | Yes | x402 `exact` SPL USDC payment; PriorSeal authorizes and compares the complete compiled transaction message. |

Base Sepolia (`eip155:84532`) remains an observation and integration-test chain;
it is deliberately not a production payment rail.

## Standard versus advanced release scope

The rows above describe chain capability, not a blanket product commitment. The
standard Verified Action release uses a configured generic EVM observation or a
complete Solana mainnet-beta compiled-message observation, together with the
deployment's standard RFC 3161 pre-execution proof and a portable local-review
bundle. The selected deployment must publish all of those inputs in
`GET /v1/capabilities` before a customer can rely on the path.

Witness quorum, EVM anchoring, ERC-4337, Safe 4337, EIP-7702, and Hyperliquid
are advanced profiles. Their additional pins, provider requirements, or venue
dependencies must be verified separately for every deployment and should be
named in the integration scope. See the [Verified Action release profile](../product/verified-action.md#standard-release-profile-and-advanced-profiles).

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

## Evidence API profile

Every execution receipt can be delivered through the chain-neutral
[`Evidence API`](evidence-api.md). Its EVM profile applies to each supported
EIP-155 chain in this matrix, including Monad (`eip155:143`) and HyperEVM
(`eip155:999`); its Solana
profile applies only to the compiled Solana transaction path. A profile is a
description of signed receipt fields and their verification route, not a claim
that a chain-specific advanced feature is available. In particular, Monad's
future concurrency-oriented evidence must add directly observed, verifiable
fields before it is advertised as a separate capability.

## Payment versus the subject execution

An x402 buyer may pay in any configured and facilitator-supported payment rail
for a PriorSeal service about a transaction on another chain. Payment evidence
therefore carries its own `payment.requirement.network`; execution receipts
retain their independently authorized subject chain. Consumers must not infer
that the payment network settled or executed the subject action.
