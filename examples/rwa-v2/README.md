# RWA v2 full workflow (simulation)

Build both workspace SDKs, then run from the PriorSeal repository root:

```sh
npm run sdk:build
node examples/rwa-v2/verify.mjs ../insight
```

Without a peer path, `npm run rwa:verify` uses the pinned vendored producer (CI mode).
With a peer path, it loads the actual built Insight SDK and compares the source locks.

The example runs actual cryptography, principal acceptance, semantic decoding,
durable local claims, restart replay protection and combined receipt verification.
Broadcast and chain observation are synthetic: no RPC, real transaction, wallet
credential or production data is used.

See [hardening and operating boundaries](../../docs/rwa-hardening.md) and
[recorded local output](verification-result.json).
