# RWA v2 evidence boundary

RWA v2 binds independently signed assessment and admission evidence to a bounded
exact call, then lets a reviewer distinguish cryptographic integrity, trust,
time, policy and observed execution. It is an evidence and verification
integration: PriorSeal does not provide an RWA transaction signer, submission
adapter, durable broadcast queue or retry service.

## Implemented evidence controls

| Concern | Evidence control |
| --- | --- |
| Assessment ordering | The RWA v2 EIP-712 domain binds a sequence and `previousDigest`; later reports must strictly follow the prior report. |
| Call semantics | The admitted ABI is decoded and re-encoded before input/output assets, direction, amounts, receiver, fee, deadline and native value are evaluated. |
| Instrument admission | Production reports bind the registry identifier and version, registry digest, instrument ID and admission digest; a mismatch fails closed. |
| Execution disposition | `inspectRwaReportV2()` and `inspectRwaReceiptBundle()` separately report integrity, trust, time, policy, execution and required external checks. A real reverted or insufficient-output observation is not confused with a forged document. |
| Cross-repository consistency | PriorSeal and Insight share a source lock and frozen vectors; CI rejects an unreviewed protocol drift. |

## Integration boundary

An integrator independently admits the chain, deployment, instrument,
quote token and execution environment. It prepares the bounded call, obtains
the principal's PriorSeal authorization, submits through its own controlled
execution path, and supplies the resulting transaction identifier for
observation. A reviewer can then inspect the signed reports and the PriorSeal
receipt bundle with separately established trust roots.

The RWA helpers do not establish legal compliance, market availability,
reserves, corporate actions, venue correctness or security-holder rights.
They also do not hold a wallet key or make an observation permission to submit
another transaction.

## Verification

In the Insight repository, run `npm run sdk:test`, `npm run test:reliability`
and `npm run rwa:parity -- --peer ../PriorSeal`.

In PriorSeal, run:

```sh
npm run check
npm run test:coverage
node examples/rwa-v2/verify.mjs ../insight
```

The joint example loads both compiled SDKs and verifies linked signed
assessments, principal authorization, semantic call admission and a signed
receipt. All fixture data, observations and public keys are simulations; the
example makes no production-execution claim.
