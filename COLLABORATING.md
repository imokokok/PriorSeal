# Collaborate with PriorSeal

PriorSeal is open to focused design partnerships with teams building EVM agents, treasury automation, wallets, policy or risk systems, and transaction infrastructure. The best first engagement connects one bounded execution path to PriorSeal and asks an independent reviewer to verify the resulting evidence outside the service.

## Suggested two-week pilot

1. Select one existing EVM execution path and define its exact authorization boundary.
2. Prepare and sign a `priorseal.authorization.v2` authorization before execution.
3. Bind any external quote, risk, policy or approval record through a namespaced context commitment when relevant.
4. Observe the submitted transaction through the PriorSeal API.
5. Export the v3 receipt or verification bundle and verify it locally with a separately pinned issuer key.

A pilot succeeds when the partner can reproduce the authorization, timing, execution state and compliance result; distinguish non-compliance from unavailable or unrelated evidence; and retain the receipt without depending on the PriorSeal HTTP verifier.

PriorSeal does not construct, sign or submit the partner's transaction. The partner owns its agent, wallet, business policy and execution path; PriorSeal provides authorization and execution evidence around that path.

## Start

- Review the [first-release scope](docs/product/first-release-scope.md) and [threat model](docs/security/threat-model.md).
- Try the [live console](https://priorseal.xyz/app) or install [`priorseal-sdk`](https://www.npmjs.com/package/priorseal-sdk).
- Run `npm run example:receipt` followed by `npm run verify:receipt` for a self-contained local receipt.
- [Open a pilot request](https://github.com/imokokok/PriorSeal/issues/new?template=pilot.yml) with the execution path, chain and intended evidence consumer. Do not include private keys, credentials, confidential transaction metadata or production database information.

For protocol or implementation contributions, follow [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).
