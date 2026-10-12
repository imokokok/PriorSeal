# PriorSeal consumer disposition v1

This synthetic, offline example consumes the published
[Open Evidence Lab exact-call matrix](../open-evidence-lab-exact-call-matrix-v1/README.md)
report and demonstrates one downstream policy for handling its results.

It assigns a disposition to an evidence record:

| PriorSeal result | Example disposition |
| --- | --- |
| Valid claims, exact envelope binding, `COMPLIANT`, `COMPLETED` | `ACCEPT_RECORD` |
| Envelope mismatch or `NON_COMPLIANT` | `REJECT_RECORD` |
| Missing evidence, `NOT_ASSESSABLE`, or `UNDETERMINED` | `HOLD_FOR_REVIEW` |

The policy fails closed on malformed or unsupported input. It is an example
consumer implementation, not a PriorSeal standard or a third-party integration.
It assigns a post-execution record disposition; it does not block, reverse,
settle, or otherwise change a transaction.

## Run

From the PriorSeal repository root, with Node.js 22 or later:

```sh
npm ci
node examples/open-evidence-lab-exact-call-matrix-v1/verify.mjs
node examples/priorseal-consumer-disposition-v1/verify.mjs
```

The second command reads the matrix's committed `report.json`, checks its pinned
SHA-256, contract and report schema at runtime, and prints a machine-readable
disposition report. Add `--write` to refresh this directory's `report.json`.

## Attribution and limits

The upstream authorization profile and its evidence vocabulary belong to
PriorSeal. This consumer policy and its adapter are also authored in PriorSeal;
they are not the external reviewer's reader and do not constitute independent
reproduction. The reviewer independently ran the pinned v1.0.0 matrix. An
independent rerun of v1.0.1 remains pending.
