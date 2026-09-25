# 402Signal fixture provenance after the public repository replacement

The EIP-3009 offline fixture in `examples/402signal-eip3009-settlement-binding-v1/` records 402Signal commit `ca6e2f1ee806bec6621487338ba6ed3f1ac09352` as its historical source. Ross reported that the public client repository was replaced at the same GitHub address on 2026-09-19. On 2026-09-25, the current GitHub commit API returned `No commit found for SHA` for that commit. The source pin remains part of the fixture's original provenance; it is no longer a retrievable commit in the current public repository.

The [official `route-guard-v0.7.3` release](https://github.com/402signalhq/402signal/releases/tag/route-guard-v0.7.3) remains available. Its `402signal-route-guard-0.7.3.tgz` has SHA-256 `bb5b49e63b37297b4460c37c6337ff80070988f8103c55ac309549d7d1790f76`, matching the release's `SHA256SUMS` and GitHub asset digest. Files extracted from that archive match the fixture's `fixture/raw/route-context.json` pins:

| Release file | SHA-256 |
|---|---|
| `package/index.mjs` | `c3ee556e0e9a66f24e9579a536f929f2d4ab3bb75d47200a7e7ece470f1247e3` |
| `package/internal-json.mjs` | `3620a93d28bed6ee1992f085345deb5321f8966e2febf6c6a8a991109917105b` |

The current 13-file manifest matches all bytes and hashes. An isolated Node.js v22.23.2 run of `node verify.mjs` passes all nine vectors, including the three pre-release blocks and the timeout/reorg replacement holds. `npm run check` passes with 348/348 Node tests. This does not establish that the release archive's bytes were unchanged across the repository replacement: a pre-replacement archive was not available for that comparison. It does not establish the recipient's delivery hash or independent acceptance.

This note does not modify the delivered fixture, its manifest, its standalone verifier, or the fixed direct-call v1 construction.
