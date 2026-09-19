# APS decision evidence × PriorSeal sibling adapter

Experimental offline example for [APS #163](https://github.com/aeoess/agent-passport-system/issues/163). It verifies APS producer inputs and correlates their `decision_ref` with a separately principal-signed PriorSeal exact-call authorization. It reports APS evidence validity, PriorSeal evidence validity and compliance, and composition separately.

The result is **execution correlated to the principal-signed authorization and the APS decision**. All execution observations here are synthetic. A successful run is neither a chain-observation proof nor evidence of production adoption or endorsement.

## Run

From this directory, with Node.js 22 or later:

```sh
npm ci --ignore-scripts
npm run verify:producer
npm run verify
```

Installation needs the npm registry; both verification commands run offline afterward. The example independently pins `agent-passport-system@6.0.1`, `priorseal-sdk@0.4.0` and `viem@2.56.3`. It is not a root workspace dependency and does not change either SDK's core exports. `npm run verify` emits machine-readable JSON and exits nonzero on an unexpected result.

From the PriorSeal repository root, after `npm ci` and the example install:

```sh
npm run test:aps-priorseal
npm run example:aps-priorseal
```

CI installs this isolated lockfile and runs both the unmodified producer consumer-script and the adapter test suite. Tests use PriorSeal repository builders to produce freshly signed negative artifacts. Optional `node generate-priorseal.mjs` regenerates only the four PriorSeal test receipts using public deterministic test keys; it never changes APS artifacts.

## Outcomes

| Case | APS | PriorSeal / composition |
|---|---|---|
| permit | Verified, unexpired at reference time | Principal signature, receipt and call binding verify; `COMPLIANT` |
| narrow | Verified, both mapped predicates pass | Principal signature, receipt and call binding verify; `COMPLIANT` |
| deny | Bound ref, `valid: false`, `valid_until_absent` | Rejected before authorization callback |
| expired | Composite `valid: true`, expired at reference time | Rejected before authorization callback |
| changed observed execution value | Verified permit | Cryptographically valid evidence, `NON_COMPLIANT`; decision/authorization binding remains valid |
| reused decision ref | Same verified permit | Two distinct signed authorizations with different nonces; `singleUseEstablished: false` |

Additional tests cover missing, changed, ambiguous and wrong-algorithm commitments; overlong and expired validity; chain/target/calldata/value mismatch; failed and unmapped narrow predicates; unresolved/wrong APS keys; wrong delegation and PriorSeal keys; altered principal signature; swapped decision evidence; duplicate JSON members; and reference-time boundaries. Composition failures preserve the other system's independently valid evidence.

## Verification boundary

`adapter.mjs` uses only public APS package-root exports: `verifyReceiptV1Serialized`, `verifyReceiptWithDecisionV1` and `verifyAuthorityDelegationChain`. It enforces the fixture's receipt-type rules, `prev` link, issuer/agent relationships, matching action/delegation refs and the decision result/evidence equality in addition to generic signature verification. It gates on the composite verifier before allowing a principal signing callback.

`trust.mjs` pins all three APS public keys and the separate PriorSeal issuer key. `aps-inputs/keys.json` is retained as producer provenance, never used as a source of runtime trust. All keys are test-only; no claim of real-world authority follows from these pins. The principal's EOA signature establishes account control; the fixture's user ID is self-asserted.

The adapter maps the call from the verified evidence's `policy_input.requested_call`. The producer `case.json` and its expected results are not runtime authorization inputs. Chain, target, calldata and value are checked against the PriorSeal intent. The executor and transaction nonce come from the PriorSeal caller and are principal-signed, not APS-attested. APS's `action_ref` is not recomputed, while `decision_ref` is recomputed inside the public composite verifier. No builder is reimplemented or deep-imported.

Only these fixture-local narrow strings have an adapter mapping:

- `fixture:evm.to=<lowercase address>` requires that exact target.
- `fixture:evm.value_wei<=<decimal integer>` caps native value using integer comparison.

All constraints must map and pass. Unknown/empty narrow constraints fail closed. These mappings, `fixture:evm:call`, and the producer's effective-authority digest are not APS protocol rules. The synthetic policy/context/spend data does not prove policy correctness, completeness, spend reservation or economic safety.

Time is fixed at `2026-09-19T10:05:00.000Z`; validity must extend strictly beyond it, and PriorSeal intent/authorization validity must not exceed APS `valid_until`. The bundled `active` revocation observation supports only the recorded state. Neither live revocation nor APS currency at chain execution is established.

The adapter has no decision-consumption registry. Every report states `singleUseEstablished: false`, including successful reuse across independently signed intents. PriorSeal's per-authorization `maxUses: "1"` policy is a different boundary; an offline verifier does not demonstrate durable runtime enforcement of that policy.

## Provenance

APS producer: Tymofii Pidlisnyi, [commit 948f99b85343bef2c6fa677c8543965caacfc087](https://github.com/aeoess/agent-passport-system/commit/948f99b85343bef2c6fa677c8543965caacfc087), `fixtures/priorseal-decision-binding/`, built at v6.0.1. Original input bytes, `MANIFEST.sha256`, `keys.json`, README and consumer verifier are copied without modification under `aps-inputs/`; Apache-2.0 LICENSE and NOTICE are preserved. The producer generator is intentionally not copied. Its README's producer instructions apply to the source repository.

The producer manifest covers 17 JSON files and is itself pinned by SHA-256 `2bf365bc9124ecfc943d5be86c34e8e0cacd51a5929b8d0c906e633a017231f9`. The adapter verifies both this manifest pin and each listed file. Source integrity and signer authority remain distinct checks.

PriorSeal artifacts under `priorseal-inputs/` are author-produced synthetic v3 execution receipts generated by the local PriorSeal builders and verified with the published SDK 0.4.0. See the [claim-boundary design](../../docs/architecture/aps-priorseal-claim-boundary.md) for the broader scope.
