# RunProof first-release product scope

## Primary user

The first release serves agent builders and treasury engineering teams that need a portable, independently verifiable statement connecting a pre-authorized intent to an observed EVM execution.

Auditors are the primary evidence consumer. They do not need wallet access and should be able to inspect a downloaded receipt or evidence bundle without trusting the RunProof HTTP verification endpoint.

## Core journey

1. Define a bounded intent before execution.
2. Observe an explicitly identified EVM transaction.
3. Review confirmation/finality and binding reason codes.
4. Download the signed receipt or a local audit bundle.
5. Verify the receipt independently with the issuer's published public key.

## Product vocabulary

- **Intent:** a pre-authorization statement, not a submitted transaction.
- **Observation:** what a configured RPC source returned at a point in time.
- **Receipt:** an issuer-signed observation statement, not an economic guarantee.
- **Local activity:** browser-local convenience data, not a complete server archive.
- **Audit bundle:** a portable export of filtered local evidence and available context; each receipt remains independently verifiable.

## First-release success criteria

- A new user can understand and complete the evidence flow in under three minutes when API, RPC and issuer signing are configured.
- Pending, unavailable, reverted, insufficient-finality and reorg states cannot be mistaken for a completed proof.
- Every signed receipt can be downloaded and checked outside the RunProof service.
- Product copy consistently states what RunProof proves and does not prove.

## Explicit non-goals

- Wallet custody, transaction construction, transaction signing or broadcast.
- Economic safety scoring, token legitimacy guarantees or investment recommendations.
- Treating one RPC provider as an absolute source of truth.
- Presenting browser-local activity as an organizational system of record.

## Later product milestones

- Authenticated projects, environments, roles and server-side evidence archives.
- Read-only receipt sharing with revocation/supersession status.
- Policy templates, approval workflows, notifications and webhooks.
- Published SDK/CLI distribution for the already browser-compatible local verifier.
