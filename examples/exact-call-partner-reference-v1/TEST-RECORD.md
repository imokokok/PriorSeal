# Exact-call partner reference v1 — local test record

## Scope

This record covers the checked-in synthetic fixture only. It does not record a
wallet signature from a user, a broadcast transaction, a live RPC response, or
an independently established issuer-trust relationship.

## Clean-run command

From the repository root, with Node.js 22 or later:

```sh
npm ci
npm ci --prefix examples/aps-priorseal-decision-binding-v1 --ignore-scripts
npm run sdk:build
npm run core:build
node examples/exact-call-partner-reference-v1/generate-fixtures.mjs
node examples/exact-call-partner-reference-v1/verify.mjs
```

Expected terminal result:

```json
{
  "summary": { "result": "PASS" }
}
```

## Observed assertions

| Check | Expected result |
| --- | --- |
| top-level and bundle manifests | every recorded SHA-256 matches |
| exact-match receipt | valid, `OK`, `COMPLIANT`, `CONFIRMED`, `COMPLETED` |
| target / calldata / expiry cases | signed evidence is valid but binding is non-compliant with the documented reason codes |
| chain case | signed evidence is valid but binding is `CHAIN_MISMATCH` and compliance is `NOT_ASSESSABLE` |
| context negative input | `CONTEXT_COMMITMENT_DIGEST_MISMATCH` |
| tampered bundled receipt | invalid with `INVALID_SIGNATURE` |

The valid receipt proves only the signed authorization, issuer acceptance,
synthetic execution content, and receipt integrity relative to the supplied
public key. The key must be trusted independently. Transaction construction,
key custody, broadcast, economic safety, and context-document semantics remain
the integrator's responsibility.
