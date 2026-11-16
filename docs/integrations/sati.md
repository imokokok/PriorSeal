# SATI / Solana Agent Registry

PriorSeal now publishes a SATI-compatible ERC-8004 registration document at:

`https://priorseal.xyz/.well-known/sati-agent.json`

It advertises the live MCP and OpenAPI services, x402 support, and reputation as
the supported trust model. This is the metadata prerequisite for SATI; it is not
itself proof that a Solana Token-2022 identity NFT or a reputation attestation
exists.

## Remaining operator step

SATI registration is a wallet-signed Solana mainnet transaction. Register the
document with the SATI SDK using the wallet that should own the PriorSeal agent
identity. Do not reuse the Insight evidence signer unless that is explicitly the
intended owner wallet. The transaction should produce a PriorSeal mint address
and a Solana agent ID.

After the mint is created:

1. Add the returned mint to the public registration file's `registrations[]`
   entry using the SATI registry CAIP-2 value.
2. Run the read-only checker with `--mint <MINT>`.
3. Add the SATI dashboard and reputation badge links to the public docs.
4. Collect the first independent feedback or validation attestation; the mint
   alone is identity registration, not reputation evidence.

The checker does not sign, submit, or pay for transactions:

```bash
node scripts/check-sati-agent.mjs
node scripts/check-sati-agent.mjs --mint <MINT>
```

SATI treats Token-2022 as the identity layer and FeedbackPublicV1/FeedbackV1
or ValidationV1 as the reputation/validation layer. See the [SATI ERC-8004
guide](https://docs.sati.cascade.fyi/erc-8004) and [feedback guide](https://docs.sati.cascade.fyi/guides/collecting-feedback).
