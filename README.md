# PriorSeal

**Connect explicit authorization to observed EVM and Solana execution with independently verifiable evidence.**

[![CI](https://github.com/imokokok/PriorSeal/actions/workflows/ci.yml/badge.svg)](https://github.com/imokokok/PriorSeal/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/priorseal-sdk)](https://www.npmjs.com/package/priorseal-sdk)
[![MIT License](https://img.shields.io/badge/license-MIT-151513.svg)](LICENSE)

[Live console](https://priorseal.xyz/app) · [TypeScript SDK](https://www.npmjs.com/package/priorseal-sdk) · [API specification](https://priorseal.xyz/openapi/v1.json) · [Pilot collaboration](COLLABORATING.md)

An agent can propose and execute a transaction, but a transaction hash alone cannot show **who authorized the action, what they approved, or whether the observed execution matched it**. PriorSeal connects a principal-signed, time-bounded authorization to an identified EVM or Solana execution in a portable receipt that another party can verify independently. Its core is the relationship between **what was authorized before action** and **what was observed afterward**.

```text
Bounded intent → Principal signature → Acceptance + time evidence
               → EVM / Solana observation → Signed receipt → Independent review
```

PriorSeal is for teams building EVM and Solana agents, treasury automation, wallets, and transaction infrastructure. It sits beside the system that constructs, signs, and submits transactions; it does not hold wallet keys or move funds.

## Choose your integration path

| Need | Start here |
| --- | --- |
| Inspect oracle data and assess its use in a trade | [Insight](https://github.com/imokokok/Insight#readme) and [`oracle-insight-guard`](https://www.npmjs.com/package/oracle-insight-guard) |
| Prove who authorized an exact EVM call and what was observed | [PriorSeal offline example](#run-the-offline-example) and [`priorseal-sdk`](sdk/README.md) |
| Start a reproducible exact-call integration and hand a reviewer a portable v3 receipt bundle | [Exact-call partner reference](examples/exact-call-partner-reference-v1/README.md) |
| Bind a Solana mainnet transaction message to a wallet authorization and observed transaction | [Solana integration guide](docs/integrations/solana.md) |
| Accept x402 API payments in USDC on aligned EVM networks and Solana | [x402 payment integration](docs/integrations/x402-evm.md) · [staged rollout](docs/runbooks/x402-staging.md) |
| Bind an ERC-8004 agent identity and trust evidence to authorization | [ERC-8004 integration guide](docs/integrations/erc-8004.md) and [read-only inspector](examples/erc8004-agent-accountability-v1/README.md) |
| Review the assets, limits, recipient and router in one ERC-20 swap before authorization | [Reviewed swap authorization](docs/product/swap-authorization.md) |
| See why an agent's replanned swap needs new approval | [Offline replan demo](examples/swap-replan-demo/README.md) |
| Run a reviewed DeFi call through prepare, authorize, execute, query and recovery | [General DeFi execution gateway](docs/product/defi-execution-gateway.md) |
| Keep assessment, authorization, and execution evidence together | [Base swap v2 fixture](examples/web3-agent-kit-base-swap-v2/README.md) and [composite review manifests](sdk/README.md#composite-review-manifests) |

Insight and PriorSeal work independently. Insight provides **oracle transparency and risk intelligence**; PriorSeal provides **authorization and execution evidence**. The combined path links assessment, authorization, execution, and review while keeping each product’s trust checks separate. Start with the offline example before connecting a wallet, RPC endpoint, or API key.

For x402 API payments, the aligned production rails are Ethereum, OP Mainnet,
Polygon PoS, Monad, X Layer, Sei, Base, Arbitrum One, Avalanche C-Chain, and
Solana mainnet-beta. A rail is advertised only when its payee is configured and
the selected facilitator currently supports it; execution observation still
requires that chain's independently configured RPC endpoint.

## What the evidence covers

1. **Authority.** A user or organization signs a time-bounded, single-use EIP-712, ERC-1271, or Solana Ed25519 message authorization for an agent and executor. A deployment policy can bind a reviewed principal identity to an account; without that registry, a human-readable principal ID is self-asserted.
2. **Ordering.** PriorSeal accepts the authorization before execution. Production deployments require an independent pre-execution proof mode: RFC 3161 timestamp, witness quorum, or EVM anchor. The default development `issuer` mode provides only an issuer acceptance statement.
3. **Execution.** PriorSeal observes a specified transaction through configured EVM or Solana RPC sources and compares the supported fields with the signed intent. Solana support binds the complete legacy, v0, or v1 compiled message, including resolved v0 address lookup accounts and v1 resource configuration, and currently observes confirmed mainnet-beta transactions. It does not decode arbitrary Solana program semantics. Pending, unavailable, reverted, and reorged states remain explicit.
4. **Review.** An Ed25519-signed v3 receipt separates evidence validity, execution state, and authorization compliance. A reviewer can download it and verify its hashes, signatures, policy result, and binding locally with an independently confirmed issuer key. A paid x402 receipt-bundle export can additionally carry a signed payment-to-resource evidence statement without conflating the payment rail with the subject execution chain.

For EVM contract calls, the `priorseal.intent.v2` exact-call profile binds the transaction envelope: chain, executor, nonce, target, calldata hash, and native value. The Solana transaction profile binds the signed message bytes represented as compiled instruction and account data. Optional context commitments bind digests of external decisions, assessments, or a block-pinned ERC-8004 identity snapshot without claiming that PriorSeal made those decisions. See the [evidence relationship levels](docs/architecture/evidence-relationship-levels.md), the [Solana integration guide](docs/integrations/solana.md), and the [ERC-8004 integration guide](docs/integrations/erc-8004.md).

For ERC-4337 smart accounts, a second `intent.v2` profile binds the canonical UserOperation hash and supports commitments from Insight's signed risk assessments. EIP-7702 observation supports predelegated EntryPoint v0.7 accounts and marker-based v0.8/v0.9 flows, binding a signed authorization tuple when the operation requests a fresh delegation; all profiles pin delegate code and verify exact bundle calldata plus transaction-level delegation state. See the [ERC-4337 integration guide](docs/integrations/erc-4337.md) for supported scope and the distinction between UserOperation evidence and ordinary bundler transaction observation.

**A valid receipt is evidence of signed claims, not a guarantee of economic safety or an infallible RPC view.** ERC-1271 authority and EVM anchors require additional chain-state checks for complete verification. A key included in a downloaded bundle is discovery data; the reviewer must establish trust in that key separately.

## Try it

### Use the hosted console

Open the [PriorSeal console](https://priorseal.xyz/app). Its quickstart checks the deployment's configured capabilities before wallet signing. You can create an authorization, observe a transaction, export the receipt, and review it in the [local verifier](https://priorseal.xyz/app/verify). The console's activity list is browser-local; it is not a complete server-side history.

### Run the offline example

Repository development requires **Node.js 22+**. This example generates a temporary key pair and a **synthetic execution** so you can inspect the receipt and verifier without an RPC endpoint or funds:

```bash
npm ci
npm run example:receipt
npm run verify:receipt
```

The verifier should report `valid: true`, `code: OK`, `outcome: COMPLETED`, `executionStatus: CONFIRMED`, and `complianceStatus: COMPLIANT`. These are results for the synthetic fixture, not proof of an on-chain transaction. Confirm the public key independently before relying on a receipt from another issuer.

The artifacts are written to the ignored `examples/receipt-artifacts/` directory. To verify a different receipt and trusted public key:

```bash
npm run verify:receipt -- /path/to/receipt.json /path/to/public-key.pem
```

### Run the API and console locally

After `npm ci`, copy `.env.example` to `.env.local`, configure development issuer key-file paths and an RPC endpoint for the chain you want to observe, then start the API and UI in separate terminals:

```bash
cp .env.example .env.local
npm run start:api
```

```bash
npm --prefix web run dev
```

The UI uses Vite's displayed local URL and proxies API calls to port 3000. For database setup, key handling, and production configuration, use the [operations runbook](docs/runbooks/operations.md). Never put private keys, credential-bearing RPC URLs, or database secrets in Git.

## Integrate with TypeScript

The published [`priorseal-sdk`](sdk/README.md) supports Node.js 20+ and modern browsers. It prepares wallet authorization, calls the API, resumes durable observations, and verifies receipts locally. It does **not** sign or broadcast execution transactions.

```bash
npm install priorseal-sdk
```

```ts
import { createPriorSealClient } from 'priorseal-sdk'

const priorseal = createPriorSealClient({ baseUrl: 'https://priorseal.xyz' })
const capabilities = await priorseal.capabilities()

const flow = await priorseal.authorizeWithWallet({
  intent,
  audience: capabilities.audience,
  principal: { type: 'user', id: 'user:42' },
  delegate: { agentId: 'agent:treasury', executor: intent.sender },
}, window.ethereum)

// Your execution system submits the authorized transaction and supplies txHash.
const evidence = await priorseal.observeExecutionUntilFinal({
  authorizationId: flow.accepted.authorization.authorizationId,
  chainId: Number(intent.chainId),
  txHash,
  confirmations: 12,
})
```

This is an integration outline: `intent`, `txHash`, and the wallet provider come from your application. For an executable example with no wallet or RPC dependency, use the [offline example](#run-the-offline-example).

The [SDK guide](sdk/README.md) covers intent construction, recovery checkpoints, exact calls, and offline verification. The HTTP contract is available as [OpenAPI](https://priorseal.xyz/openapi/v1.json); the main flow uses `POST /v1/authorizations/prepare`, `POST /v1/authorizations`, and `POST /v1/executions/observe`.

## Examples and integrations

These examples have different evidence scopes. Read each example's README before treating its result as an integration or production claim.

| Example | What it demonstrates |
| --- | --- |
| [Exact-call SDK integration](examples/web3-agent-kit-context-binding-v1/README.md) | Binds a partner-owned call-envelope digest to a principal-signed authorization. |
| [Base swap v2 fixture](examples/web3-agent-kit-base-swap-v2/README.md) | Combines signed Insight advisory input, an agent-side policy decision, and PriorSeal authorization in a synthetic flow. |
| [Base Sepolia live evidence](examples/web3-agent-kit-base-sepolia-live-v1/README.md) | Verifies one real testnet transaction authorized before signing; it does not include a live Insight attestation. |
| [RWA v2](examples/rwa-v2/README.md) | Links assessment evidence to exact calls and reports integrity, trust, time, policy, and execution separately. |
| [APS decision binding](examples/aps-priorseal-decision-binding-v1/README.md) | Correlates an independently verified APS decision with authorization and synthetic execution evidence. |
| [Open Evidence Lab exact-call matrix](examples/open-evidence-lab-exact-call-matrix-v1/README.md) | Synthetic, offline interoperability case; the independent cold run is pinned to v1.0.0, and v1.0.1 is awaiting a separate rerun. See the [case study](docs/case-studies/open-evidence-lab-priorseal-exact-call-reproduction-2026-10.md). |
| [Consumer disposition example](examples/priorseal-consumer-disposition-v1/README.md) | Applies a small downstream policy to the matrix report: accept an exact completed match, reject mismatches, and hold incomplete evidence for review. |

Other partner fixtures are under [`examples/`](examples/). Insight can be used independently for assessment evidence; PriorSeal can be used independently for authorization and execution evidence; a combined workflow can bind the two without merging their trust roots.

## Documentation

| Topic | Start here |
| --- | --- |
| Product scope and evidence limits | [Positioning](docs/product/positioning.md) · [First-release scope](docs/product/first-release-scope.md) · [Evidence relationship levels](docs/architecture/evidence-relationship-levels.md) |
| Authorization and receipt semantics | [Signed authorization](docs/architecture/signed-authorization.md) · [Temporal evidence and finality](docs/architecture/temporal-finality.md) · [Lifecycle](docs/architecture/lifecycle.md) · [API compatibility](docs/api/compatibility.md) |
| Security and operations | [Threat model](docs/security/threat-model.md) · [Supply-chain controls](docs/security/supply-chain.md) · [Operations](docs/runbooks/operations.md) · [Cloudflare deployment](docs/runbooks/cloudflare.md) |
| SDK and integration recovery | [SDK guide](sdk/README.md) · [Reliability runbook](docs/runbooks/reliability.md) |
| Solana transaction authorization and observation | [Solana integration guide](docs/integrations/solana.md) |
| Payment, observation, and advanced-profile boundaries by chain | [Chain capability matrix](docs/architecture/chain-capabilities.md) |
| x402 API payments on aligned EVM networks and Solana | [x402 payment integration](docs/integrations/x402-evm.md) · [staged rollout](docs/runbooks/x402-staging.md) |
| Sandbox adapter proposal | [APS checkout-gate per-order limit check](docs/integrations/aps-checkout-gate-limit-check-2026-10.md) |

Run `npm run check` for the repository checks, or `npm run release:check` for the full release gate. Production runs the API and console on Cloudflare Workers with D1 persistence; local Node deployments can use PostgreSQL.

## Work with PriorSeal

For a pilot, choose one bounded EVM or Solana execution path and ask an independent reviewer to reproduce the authorization, timing, observation, and compliance result from its exported evidence. See the [collaboration guide](COLLABORATING.md) or [open a pilot request](https://github.com/imokokok/PriorSeal/issues/new?template=pilot.yml). Code contributions follow [CONTRIBUTING.md](CONTRIBUTING.md); security reports follow [SECURITY.md](SECURITY.md).

MIT licensed. See [LICENSE](LICENSE).
