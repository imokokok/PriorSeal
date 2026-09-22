# Opt-in Insight coverage binding

The SDK now supports a consumer-side data-readiness gate without changing
PriorSeal authorization or receipt schemas. Insight evaluates oracle evidence;
PriorSeal commits the independently verified report digest in an exact-call
intent. A coverage PASS does not prove trade safety, settlement health or
principal permission. Verify the actual authorization and exact call separately.

```ts
import { buildCoverageBoundIntent, withCoverageBoundIntent } from 'priorseal-sdk';

// Trust is independent configuration: policy bytes + policyId, asset/evidence
// chain and admitted keys with validity intervals and revocation status.
const requirements = [
  { side: 'source' as const, proof: sourceCoverageReport, trust: sourceTrust },
  { side: 'destination' as const, proof: destinationCoverageReport, trust: destinationTrust },
];
const intent = await buildCoverageBoundIntent(exactCallInput, requirements);
// Prepare, principal-sign, accept and verify this exact intent through the normal
// PriorSeal authorization flow. Do not substitute the original unbound input.
await withCoverageBoundIntent(verifiedAuthorization.intent, requirements, async () => {
  return executor.submit(verifiedExactTransaction);
});
```

Intent validity is capped to report validity. Source and destination use separate
`insight.coverage.source.v1` and `insight.coverage.destination.v1` namespaces.
The helper refuses missing/duplicate/tampered commitments, unsigned reports,
untrusted/revoked keys, wrong scope, insufficient coverage and expired evidence.
Call it after authorization and immediately before entering the transaction
provider. A queue inside the callback needs its own check at the actual boundary.

Band Protocol observations are recognized as the independent `band` source
group. Insight obtains them from BandChain v3, preserves their source age and
applies the same cache-refresh and consensus-freshness rules used for other
providers. PriorSeal's default coverage policy requires the observation to be
at most 300 seconds old and to match the requested evidence chain. A fresh public REST response is not by
itself a portable BandChain state proof and cannot be relabelled as EVM-chain
evidence; retain the signed Insight report and the independently pinned policy
used to evaluate it.

Keep the report, pinned policy/trust history, authorization and execution receipt
together for audit. Historical verification must supply the historical evaluation
time and retained trust evidence; live entry always uses current time. PriorSeal's
generic receipt verifier treats external commitments as opaque and does not
automatically claim coverage verified or bypass Insight protocol trust rules.

`sdk/src/insight-coverage.ts` is an MIT-licensed consumer copy of Insight's
coverage evaluator. Preserve evaluator semantics when updating; the local source
classification may include additional explicitly reviewed consumer sources, and
cross-project tests use the same deterministic report/signature vector. Runtime has no sibling-repository
dependency and needs no server signing key. New SDK exports are additive and are
not available in previously published SDK packages until a release is published.

Run `npm run sdk:build` and `node --test test/sdk/coverage-binding.test.mjs`.
Fixtures use a public test key, never production credentials or funded execution.
