# Changelog

## Unreleased

- Added EIP-712 and ERC-1271 signed, single-use authorizations that bind a principal, agent executor, canonical intent, validity window, audience and policy hash.
- Added authorization acceptance receipts, an ordered transparency log with signed checkpoints, optional externally anchored checkpoints, and authorized execution receipt schema v2.
- Added exact EVM call constraints, post-hoc authorization detection, persistent authorization storage, HTTP preparation/acceptance APIs, and browser wallet signing.
- Added unaudited Safe execution-module and transparency-anchor reference contracts with compile checks.
- Added fail-closed production configuration, verified-full PostgreSQL TLS normalization, custody-free anchor preparation/recording commands, and an enforced pre-execution anchor gate.
- Added Gas-free multi-operator witness quorum: standalone Ed25519 witness service, parallel 2-of-3 collection, policy-bound public keys, durable attestations, fail-closed execution gating, and server/browser receipt verification.
- Added the simpler Gas-free DigiCert RFC 3161 mode: policy-bound timestamping, pinned-root CMS verification, nonce/imprint checks, durable token evidence, pre-execution enforcement, and server/browser offline verification.
- Redacted RPC endpoints from all new observation and receipt evidence.
- Bound action and containing-block execution time to intents; receipts no longer expire with their intent window.
- Added idempotent observation replay and synchronous reorg evidence across repeated observations.
- Added browser-local Ed25519 receipt verification and historical public-key registry file support.
- Made receipts immutable in memory/PostgreSQL and fixed persistent worker attempt accounting.
- Fixed atomic-amount form validation and the self-contained receipt example.
- Added a three-minute quickstart with API/signing readiness and progress states.
- Added a browser-local audit workspace with outcome, chain and evidence search filters.
- Added portable audit-bundle export containing filtered receipts and available intent/observation context.
- Hardened protocol inputs, receipt identity and verifier key checks.
- Split HTTP interface and added OpenAPI, health checks, idempotency and safe request handling.
- Added PostgreSQL observations/idempotency/job migrations, RPC resilience, CI, container assets and operational documentation.
