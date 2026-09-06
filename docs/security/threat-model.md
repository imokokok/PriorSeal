# Threat model

PriorSeal never holds wallet/transaction signing keys or moves assets. The Ed25519 issuer key signs only evidence statements.

| Threat | Control |
| --- | --- |
| Malicious HTTP caller | size/depth/content-type/field limits, rate limiter port, idempotency conflict detection, safe errors |
| Faulty or malicious RPC | explicit endpoint configuration, chain-ID and containing-block checks, response validation, per-endpoint retry/fallback, and preference for available/mined evidence over a stale endpoint's not-found/pending response; uncertainty remains undetermined |
| RPC credential disclosure | endpoint URLs remain process-local; evidence stores only `evm-json-rpc:eip155:<chain>:configured-<n>` source identifiers |
| Receipt tampering/key confusion | canonical payload signature, schema/domain/algorithm/key-ID checks, issuer/key validity checks |
| Replay | both intent creation and execution observation use bounded Idempotency-Key records with request hashes and a 24-hour TTL |
| False or post-hoc authorization | EIP-712/ERC-1271 authorizer signature, optional reviewed `policy.principals` identity mapping, complete embedded intent, issuer acceptance time, ordered hash-chain entry, single-use nonce, executor binding; use RFC 3161, a separately operated witness quorum, an external checkpoint anchor, or a Safe module when issuer-independent ordering is required |
| TSA compromise or incorrect clock | The signed policy pins the DigiCert profile; verification pins DigiCert roots, policy OID, Time Stamping EKU, imprint and nonce. Operational monitoring and a reviewed trust-profile release are still required; RFC 3161 is not decentralized consensus. |
| Witness forgery/collusion | Principal-signed policy binds threshold and distinct Ed25519 keys; duplicate identities/keys and post-execution attestations are rejected. Independence still depends on separate operators, protected keys, and trustworthy clocks; a threshold of colluding operators can lie about time. |
| Cross-deployment signature reuse | signed authorization audience and EIP-712 chain domain; configure a unique `PRIORSEAL_AUTHORIZATION_AUDIENCE` per trust domain |
| Reorg | immutable evidence versions, changed-block and post-inclusion disappearance detection, new reorg receipt rather than overwrite |
| Key compromise | file-only local provider, registry status/validity, rotation/revocation runbook; use KMS/HSM adapter in production |
| DoS/log leakage | bounded bodies, timeout, minimal errors, structured-event injection point; never log key material/auth/body/connection strings |
| Browser persistence | local-only label, validated bounded storage, export and clear; receipts in localStorage are not server archive |
| Supply chain | lockfiles, CI audit, secret scan; pin/action review remains repository-owner responsibility |

Operational limitation: independent verification proves the issuer signed the included bytes. It does not prove economic safety, RPC correctness, token semantics, internal transfers, or user intent outside the signed fields. Direct EVM transfer selectors and empty-calldata native transfers are classified as `TRANSFER`; other calldata is classified as `CONTRACT_CALL`.

V2 adds authorizer evidence. EOA authorizations are fully checkable from the portable bundle. ERC-1271 validity is contract-state dependent and can change as Safe ownership or handlers change; the default HTTP verifier checks configured current chain state. Strong historical proof requires the authorization execution module/event or a future account-state proof profile. Solidity sources in this repository are unaudited references, not production deployment recommendations.

Witness services receive authorization digests, identifiers, requester identity, and validity timestamps—not full transfer contents. Bearer credentials and endpoint locations are kept in a separate secret-mounted file. A public witness endpoint still needs rate limiting, monitoring, clock synchronization, database backup, key rotation, and an abuse policy.
