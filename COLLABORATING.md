# Collaborate with PriorSeal

PriorSeal connects explicit, pre-execution authorization to observed EVM and Solana execution through independently verifiable evidence. It is open to focused design partnerships with teams building agents, treasury automation, wallets, policy or risk systems, and transaction infrastructure. The best first engagement connects one bounded execution path to PriorSeal and asks an independent reviewer to verify the resulting evidence outside the service.

Use PriorSeal independently when authorization and execution evidence is the need. For oracle transparency and risk assessments, [Insight](https://www.oracleinsight.xyz/) is a separate offer. A combined pilot can bind Insight assessment evidence to PriorSeal authorization and execution without merging their trust roots.

## Suggested two-week pilot

1. Select one existing EVM or Solana execution path and define its exact authorization boundary.
2. Prepare the canonical EVM intent or Solana compiled-message authorization before execution.
3. Bind any external quote, simulation, risk, policy or approval record through a namespaced context commitment when relevant.
4. Observe the submitted transaction through the PriorSeal API.
5. Export the v3 receipt or verification bundle and verify it locally with a separately pinned issuer key.

A pilot succeeds when the partner can reproduce the authorization, timing, execution state and compliance result; distinguish non-compliance from unavailable or unrelated evidence; and retain the receipt without depending on the PriorSeal HTTP verifier.

PriorSeal does not custody keys or funds, choose the partner's trade, provide investment advice, or guarantee economic safety. In the standard EVM profile the partner constructs, signs and submits its transaction. The guarded Jupiter profile protects a previously compiled, wallet-signed Solana message and relays it once without altering it; it does not turn a collaboration request into a transaction authorization. The partner always owns its agent, wallet, business policy and execution path.

For a Solana Jupiter ExactIn pilot, start with the [Jupiter pilot brief](https://priorseal.xyz/jupiter/pilot-intake) and the [guarded-swap runbook](docs/runbooks/jupiter-design-partner-pilot.md). The brief is local to the browser and intentionally does not send or store lead data. A funded mainnet swap requires a second, explicit GO naming the wallet role, route boundary, maximum input, fees, expiry, support owner and evidence viewers.

## Start

- Review the [first-release scope](docs/product/first-release-scope.md) and [threat model](docs/security/threat-model.md).
- Try the [live console](https://priorseal.xyz/app) or install [`priorseal-sdk`](https://www.npmjs.com/package/priorseal-sdk).
- Run `npm run example:receipt` followed by `npm run verify:receipt` for a self-contained local receipt.
- Use the [pilot brief](https://priorseal.xyz/jupiter/pilot-intake) to scope a Jupiter business discussion, or [open a redacted developer pilot request](https://github.com/imokokok/PriorSeal/issues/new?template=pilot.yml) with the execution path, network and intended evidence consumer. Do not include private keys, credentials, wallet or transaction data, confidential counterparties, commercial terms, or production database information in a public Issue.

For protocol or implementation contributions, follow [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).
