# Threat model

RunProof never holds wallet/transaction signing keys or moves assets. The Ed25519 issuer key signs only evidence statements.

| Threat | Control |
| --- | --- |
| Malicious HTTP caller | size/depth/content-type/field limits, rate limiter port, idempotency conflict detection, safe errors |
| Faulty or malicious RPC | explicit endpoint configuration, chain-ID and containing-block checks, response validation, per-endpoint retry/fallback; uncertainty remains undetermined |
| RPC credential disclosure | endpoint URLs remain process-local; evidence stores only `evm-json-rpc:eip155:<chain>:configured-<n>` source identifiers |
| Receipt tampering/key confusion | canonical payload signature, schema/domain/algorithm/key-ID checks, issuer/key validity checks |
| Replay | both intent creation and execution observation use bounded Idempotency-Key records with request hashes and a 24-hour TTL |
| Reorg | immutable evidence versions, block hash detection, new reorg receipt rather than overwrite |
| Key compromise | file-only local provider, registry status/validity, rotation/revocation runbook; use KMS/HSM adapter in production |
| DoS/log leakage | bounded bodies, timeout, minimal errors, structured-event injection point; never log key material/auth/body/connection strings |
| Browser persistence | local-only label, validated bounded storage, export and clear; receipts in localStorage are not server archive |
| Supply chain | lockfiles, CI audit, secret scan; pin/action review remains repository-owner responsibility |

Operational limitation: independent verification proves the issuer signed the included bytes. It does not prove economic safety, RPC correctness, token semantics, internal transfers, or user intent outside the signed fields. Direct EVM transfer selectors and empty-calldata native transfers are classified as `TRANSFER`; other calldata is classified as `CONTRACT_CALL`.
