# PriorSeal first-release product scope

## Primary user

The first release serves agent builders and treasury engineering teams that need a portable, independently verifiable statement connecting a pre-authorized intent to an observed EVM execution.

Auditors are the primary evidence consumer. They do not need wallet access and should be able to inspect a downloaded receipt or evidence bundle without trusting the PriorSeal HTTP verification endpoint.

## Core journey

1. Define a bounded draft intent before execution.
2. Have the controlling EVM account sign the canonical EIP-712 authorization.
3. Register the authorization and receive a signed acceptance plus independent RFC 3161 timestamp.
4. Observe an explicitly identified EVM transaction against the single-use authorization.
5. Download the v2 receipt and independently recompute authorization, binding and signatures.

## Product vocabulary

- **Intent:** an agent proposal until an authorized principal signs it.
- **Authorization:** a principal-signed, time-bounded, audience-scoped, single-use permission delegated to an executor.
- **Timestamp evidence:** a portable DigiCert RFC 3161 token proving the authorization digest existed at the signed UTC time.
- **Observation:** what a configured RPC source returned at a point in time.
- **Receipt:** an issuer-signed observation statement, not an economic guarantee.
- **Local activity:** browser-local convenience data, not a complete server archive.
- **Audit bundle:** a portable export of filtered local evidence and available context; each receipt remains independently verifiable.

## First-release success criteria

- A new user can understand and complete the evidence flow in under three minutes when API, RPC and issuer signing are configured.
- Pending, unavailable, reverted, insufficient-finality and reorg states cannot be mistaken for a completed proof.
- Every signed receipt can be downloaded and checked outside the PriorSeal service.
- A completed v2 receipt proves the EIP-712 authorizer signed the exact canonical intent and, in RFC 3161 mode, that an independent TSA timestamped it before the observed block time.
- Product copy consistently states what PriorSeal proves and does not prove.

## Explicit non-goals

- Wallet custody, transaction construction, transaction signing or broadcast.
- Economic safety scoring, token legitimacy guarantees or investment recommendations.
- Treating one RPC provider as an absolute source of truth.
- Presenting browser-local activity as an organizational system of record.

## Later product milestones

- Authenticated projects, environments, roles and server-side evidence archives.
- Read-only receipt sharing with revocation/supersession status.
- Policy templates, approval workflows, notifications and webhooks.
- Published CLI distribution and future chain-state adapters for the SDK local verifier.
- Historical ERC-1271 account-state proofs and independently operated transparency witnesses.
