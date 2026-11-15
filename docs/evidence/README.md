# Decision-input evidence: public, citable artefacts

These files are published so that a third party can cite and re-verify our claims **without contacting us and without trusting our servers**. They belong to the Insight / PriorSeal projects (`oracleinsight.xyz`, `priorseal.xyz`), both MIT-licensed.

## Files

| File | What it is |
|---|---|
| `decision-input-evidence-alignment.md` | Mapping of the implemented cryptographic evidence mechanisms onto `draft-sharif-agent-audit-trail-09` and SCITT, with an explicit list of what is **not** claimed. Chinese body, English abstract. |
| `canonicalization-profile-v1.json` | Machine-readable, measured implementation profile: RFC 8785 §3.2.2 reference sample, all 26 Appendix B number vectors, local vectors, Merkle vectors, rejection cases, and an offline verification recipe. |

## What we do NOT claim

- No AAT conformance, no SCITT conformance, no regulatory compliance, no certification.
- No RFC 8785 conformance (published vectors pass, but no full I-JSON constraint suite, and we impose stricter prototype/key restrictions).
- No RFC 6962 wire compatibility (domain-separated canonical-JSON Merkle tree, different leaf/parent construction).
- No RFC 3161 TSA token. **Production anchors are file-based records with issuer-signed checkpoints.** An `eip155` chain-anchor mode exists in code and tests but is **not enabled in production**; we have no self-deployed contract address.
- No AAT §3.1 agent-log fields: apart from a `prev_hash` analogue we emit none of `agent_id`, `principal`, `session_id`, `action_type`, `outcome`, `trust_level`, `record_phase`, etc. Our records describe decision inputs, not agent actions.

`draft-sharif-agent-audit-trail-09` is an individual Internet-Draft, not an IETF-endorsed standard, and expires 2027-04-29.

## Offline verification recipe

No vendor server and no third-party packages are required for the cryptographic checks:

1. Obtain a portable verification bundle (`GET /v1/evidence/receipts/{receiptId}`) or use the fixtures in the profile file.
2. **Pin the issuer public key out of band.** Keys bundled inside an evidence bundle are discovery metadata, not a trust anchor.
3. With Node >= 20 and `node:crypto` only: verify the Ed25519 checkpoint signature (`src/domain/ed25519.mjs`), chain continuity and Merkle inclusion proof (`src/domain/transparency.mts`, `src/domain/merkle-log.mjs`), then the file-based anchor record.
4. If (and only if) the bundle originates from a deployment with the optional `eip155` anchor mode enabled, independently re-verify that anchor over any RPC for the chain: tx hash, receipt status, blockHash, block.timestamp, calldata decode and confirmations.

`canonicalization-profile-v1.json` carries reproducible vectors so another implementation can check byte-level behaviour without running our code.

## Disclosed continuity gaps

A system claiming tamper-evident inputs cannot self-certify its own continuity, so we publish ours: 14 capture slots permanently lost on 2026-11-08, a ~10h production database outage on 2026-11-12, and a DNS / custom-domain record loss on 2026-11-15 (cause not determinable from available audit logs). These are not smoothed over.

## Corrections

An earlier internal draft overstated the `eip155` chain anchor as a live production feature and asserted that our number serialization differed from JCS. Both were corrected on 2026-11-15 after checking deployment configuration and running the RFC 8785 vectors. See §8 of the alignment note.

Questions and corrections are welcome via GitHub issues on this repository.
