# send21 draft-integrity × PriorSeal binding (v0.2)

This is an offline, profile-conformance companion to
[`send21-payment-draft-binding-v1`](../send21-payment-draft-binding-v1/). It
checks the published send21 `coreSha256` and `quote.sha256` test vectors for
the source-defined profiles `send21.draft.core.v1` and
`send21.draft.quote.v1`.

It is deliberately not an OAuth, account, live-network, custody, or
settlement flow. No API request is made by this example. It does not claim
that an unkeyed SHA-256 digest identifies a sender, proves that an owner
approved a receiving address, authorizes a PriorSeal exact call, or proves an
on-chain transfer. A PriorSeal authorization and an independently observed
execution remain separate evidence layers.

## Binding shape

For a response whose full objects verify under the published profiles, an
exact-call authorization can carry these ordinary PriorSeal context
commitments:

```json
[
  {
    "namespace": "send21.draft.core.v1",
    "algorithm": "sha256",
    "digest": "0x<coreSha256>"
  },
  {
    "namespace": "send21.draft.quote.v1",
    "algorithm": "sha256",
    "digest": "0x<quote.sha256>"
  }
]
```

The source publishes lowercase hexadecimal digests without `0x`; PriorSeal
uses the same 32-byte value with its normal `0x` prefix. The profile names in
the namespaces are material: the verifier recomputes RFC 8785 (JCS) over the
entire profile object, including every member and every `null`, then hashes
the UTF-8 canonical bytes with SHA-256. For a quote, the `sha256` member itself
is excluded from its preimage and all other members, including the legacy
`source` and `expiresAt` aliases, remain included.

The two context commitments are independent. An exact-crypto draft has no
quote, so it carries the core commitment only. A separately defined payer-view
commitment may be added later under a distinct namespace, but it cannot replace
or be described as equivalent to either source-defined profile commitment.

## Run the conformance check

```sh
npm run core:build
node examples/send21-payment-draft-binding-v2/compute-commitments.mjs --verify
```

`--verify` checks the official fiat-priced Base/USDC vectors:

| Profile | Expected lowercase SHA-256 |
|---|---|
| `send21.draft.core.v1` | `327bb193ff1cfdf2ecf25a89fb0f4a99b65aefa39524799ec43c6adab9c833d7` |
| `send21.draft.quote.v1` | `67de0e66b1a138b86e5b06e7b2fb63c4ad9a21d38f3ef6bb2eb47277dd1f3481` |

The verifier also rejects a missing required `null`, an unexpected profile
member, and a quote hash that does not match its JCS preimage. That preserves
the profile boundary rather than silently hashing a convenient include-list.

## Scope and relation to the Base Sepolia fixture

The public send21 demo endpoint used by the earlier
[`payment-draft-base-sepolia-v1`](../payment-draft-base-sepolia-v1/) fixture
does not return `core`, `coreSha256`, or a `quote` object. Therefore this v0.2
example does **not** treat that demo draft as server-authoritative evidence and
does not create a synthetic `core` claim for it. The older fixture remains a
separate client-view and Base Sepolia execution example.

The profiles and vectors are reproduced from send21's published
[draft-integrity documentation](https://send21.io/docs/draft-integrity),
checked on 2026-10-24. Any future live or testnet run requires a separately
agreed scope, observable inputs, verification boundary, and claim set before
OAuth, authenticated drafts, or network activity is considered.
