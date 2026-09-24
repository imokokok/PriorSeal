# Public payment draft × PriorSeal Base Sepolia fixture

This fixture records one real anonymous send21 demo draft, one ERC-20 USDC transfer on Base Sepolia, and a local PriorSeal exact-call authorization and v3 receipt. The payer is published Hardhat development account #1; both its funds and the issuer key are strictly test-only. The issuer key was generated for this run and its private half was discarded after the evidence bundle was written.

The demo response provides the receiver, token contract, amount, draft ID and expiry. The `transfer` calldata is derived from those fields. The payer address and transaction nonce come from the wallet/RPC at signing time. The authorization is signed and locally accepted before the transaction is signed and broadcast. Script event ordering is recorded, but no independent timestamp authority was used to prove that ordering cryptographically.

## Verify

```sh
npm run core:build
npm run sdk:build
node examples/payment-draft-base-sepolia-v1/verify.mjs
node examples/payment-draft-base-sepolia-v1/verify.mjs --online
```

Offline verification checks the independently pinned test key fingerprint in `trust-roots.json`, authorization and receipt signatures, draft-to-calldata mapping, exact-call binding and a synthetic changed-calldata negative vector. Online verification additionally reads the live send21 draft status and Base Sepolia transaction and block. The negative vector does not broadcast a second transaction.

`evidence-bundle.json` contains only public testnet information and public keys. Its send21 status snapshots are ordinary HTTPS API responses, not signed send21 attestations. The local ephemeral issuer is not the deployed PriorSeal service, and this run does not establish production integration, adoption or economic safety. The fixture and test record must be shared with send21 before describing the result publicly as a send21 example.

The broadcaster is intentionally opt-in and creates a new 30-minute demo draft:

```sh
node examples/payment-draft-base-sepolia-v1/run.mjs --use-public-test-wallet
```

It should only be rerun when a new testnet payment is intended. It checks Base Sepolia, the pinned USDC contract and test wallet balances before creating a draft. A temporary recovery journal is written after draft creation and transaction broadcast; the journal and ephemeral private issuer key are removed on successful completion.
