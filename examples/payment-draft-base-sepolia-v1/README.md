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

The reviewable TypeScript sources are [`verify.mts`](./verify.mts) and [`run.mts`](./run.mts). The `.mjs` files used by the commands above are generated runtime artifacts.

`evidence-bundle.json` contains only public testnet information and public keys. Its send21 status snapshots are ordinary HTTPS API responses, not signed send21 attestations. The local ephemeral issuer is not the deployed PriorSeal service, and this run does not establish production integration, adoption or economic safety.

The fixture and test record were shared for review. In a [public GitHub comment on 24 September 2026](https://github.com/imokokok/PriorSeal/discussions/7#discussioncomment-18579696), `send21io` confirmed the demo draft, on-chain payment, field mapping and testnet boundaries. Describe this as an **independent PriorSeal fixture against a public send21 demo draft**. It is not a send21 product integration, endorsement, or production/custody claim. send21 did not run the local PriorSeal verifier; `COMPLIANT` and `CALLDATA_MISMATCH` are PriorSeal-side results.

For file identity, cite the SHA-256 of `evidence-bundle.json` (`7e79f3341ff04bd862bb7e05fd1391febd29b8a2925f405b610d55aeccdc6f44`) and `trust-roots.json` (`e698a0c117d7b78eef70df427175a72e550c720b988d2432465e807826c8fe67`). The recipient reported that these internal file hashes matched, while the outer emailed ZIP hash differed, so the outer ZIP hash is not a reliable identifier for the archive they received.

The broadcaster is intentionally opt-in and creates a new 30-minute demo draft:

```sh
node examples/payment-draft-base-sepolia-v1/run.mjs --use-public-test-wallet
```

It should only be rerun when a new testnet payment is intended. It checks Base Sepolia, the pinned USDC contract and test wallet balances before creating a draft. A temporary recovery journal is written after draft creation and transaction broadcast; the journal and ephemeral private issuer key are removed on successful completion.
