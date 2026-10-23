# Evidence API

`priorseal.evidence.v1` is PriorSeal's chain-neutral delivery format for a
previously issued execution receipt. It makes one reviewable object available
across EVM and Solana without changing what was authorized, observed, or
signed.

```text
principal authorization -> execution observation -> signed receipt
                                                -> verification bundle
                                                -> Evidence API envelope
```

The static Evidence API endpoint is:

```text
GET /v1/evidence/receipts/{receiptId}
```

When a deployment charges its receipt-bundle export through x402, this endpoint
uses the same price and payment protection. It is not a free way to retrieve a
portable bundle. Live discovery reports that status and price under
`evidenceApi.commerce` in `/v1/capabilities`.

## Fresh Evidence Check

```text
GET /v1/evidence/receipts/{receiptId}/check
```

This x402-paid read-only resource first verifies the stored authorization-bound
v2/v3 receipt with the current issuer-key registry, then re-observes its named
transaction against its original authorization constraints. It returns a new
`priorseal.fresh-evidence-check.v1` Ed25519 statement stamped with `checkedAt`.
It is intentionally a new product rather than a relabelled static export: the
check reports current RPC/finality observation and rebinding outcome. It cannot
submit a transaction, authorize a future transaction, custody keys, or replace
an independent reviewer’s own RPC trust decision.

The x402 challenge includes opt-in Bazaar discovery metadata. This makes an
eligible paid resource indexable by compatible agent discovery clients while
the free PriorSeal MCP server continues to return only a purchase handoff.

The response contains the original portable verification bundle, a profile for
the receipt's chain family, and compact claims copied from the receipt. It uses
`kind: AUTHORIZATION_BOUND_EXECUTION` only when the receipt contains an
authorization; historical receipt-only records use `kind: EXECUTION`. The
envelope carries an `evidenceHash` for transport integrity, but it is not a new
signature or a new trust root.

## Trust boundary

An Evidence API result is available only for a receipt PriorSeal already
issued. It does not accept arbitrary transaction hashes, submit transactions,
hold wallet keys, or interpret a service payment as authority over a subject
transaction.

`claims.receiptSignature.status: PRESENT_NOT_VERIFIED` means precisely that a
signature field is present. Before any approval, reconciliation, underwriting,
or automation decision, a consumer must verify the embedded
`priorseal.verification-bundle.v1` locally and pin issuer-key trust outside the
bundle. The response states this requirement in
`verification.required`.

## Chain profiles

The deployment advertises active profile scope in
`GET /v1/capabilities` under `evidenceApi.profiles`.

| Profile | Scope | What it represents |
| --- | --- | --- |
| `priorseal.evidence-profile.evm.v1` | EIP-155 execution receipts | Exact authorization binding, observed EVM execution and finality metadata already present in the signed receipt. |
| `priorseal.evidence-profile.solana-transaction.v1` | Solana mainnet-beta compiled-transaction receipts | The bound compiled transaction and confirmed-observation metadata already present in the signed receipt. |

Monad (`eip155:143`) uses the EVM profile today. This is intentionally an
honest shared baseline: the profile offers the same portable authorization and
execution evidence as other supported EVM networks. Monad-specific concurrency
or account-model claims will be introduced only with corresponding observed,
verifiable fields rather than being inferred from the network name.

## Integration surfaces

- REST: `GET /v1/evidence/receipts/{receiptId}` and `GET /v1/evidence/receipts/{receiptId}/check`
- SDK: `client.getEvidence(receiptId)`
- MCP: `priorseal_get_evidence` and `priorseal_get_fresh_evidence_check` return
  a free x402 purchase handoff only; they never include a free copy of a paid
  envelope, bundle or fresh-check result.
- Discovery: `/v1/capabilities`, `/openapi/v1.json`, and
  `/.well-known/priorseal-agent.json`

The existing `GET /v1/receipts/{receiptId}/bundle` endpoint remains available
for integrations that consume the lower-level bundle directly. Its MCP tool
returns the same purchase handoff boundary rather than the bundle contents.
