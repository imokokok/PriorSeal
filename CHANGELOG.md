# Changelog

## Unreleased

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
