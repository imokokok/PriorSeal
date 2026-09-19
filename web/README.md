# PriorSeal console

Run with Node.js 22 or newer. `npm --prefix web run dev` serves the console; `npm --prefix web run build` builds the SDK and production UI. `VITE_API_BASE_URL` selects the deployment (same-origin by default).

## Authorization and recovery

`/app/intents/exact-call` imports a constructed EVM transaction (`chainId`, `from`, `to`, `nonce`, `data`, optional `value`) and uses `buildExactCallIntent` from the SDK. Context digests are bound directly. Asset and amount are descriptive for this profile, not independently verified token settlement amounts. The page loads deployment capabilities before asking for a wallet account and shows the server-canonicalized authorization before requesting a signature. It never signs or broadcasts an execution transaction.

The SDK reconstructs the signing payload locally, checks it against the prepared typed data and original requested fields, and verifies the wallet signature before acceptance. An acceptance retry keeps the exact signed authorization and operation idempotency key. Changing any input clears the prepared and signed state. Use “Export recovery checkpoint” and import that checkpoint after a refresh to retain the same signed bytes and operation key. An already signed expired checkpoint may only replay an existing acceptance; the result is labeled historical and must not authorize a new execution. An unsigned expired checkpoint cannot sign. This recovery mechanism is not a signing wallet.

Observation views preserve `PENDING`, `RPC_TIMEOUT`, and `UNDETERMINED` as uncertainty. Background retry state, job ID, next attempt and reconciliation instructions are visible. Observation retries must use the original transaction hash; a timeout is not permission to broadcast another transaction. Local rotation diagnostics are limited to known browser records and never claim to enumerate every server authorization.

## Offline review and trust

`/app/verify` accepts a receipt, a `priorseal.verification-bundle.v1` bundle, or a `priorseal.review-manifest.v1` sidecar. Receipt and bundle keys do not establish trust. Import independently obtained issuer configuration or enter a public key, expected issuer and audience, then explicitly confirm its source.

Example profile shape (replace placeholders with independently provisioned values):

```json
{
  "schema": "priorseal.trust-profile.v1",
  "name": "Production reviewer",
  "issuer": "your-issuer",
  "audience": "your-deployment",
  "keys": [{
    "issuer": "your-issuer",
    "keyId": "2026-09",
    "algorithm": "Ed25519",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----",
    "status": "active",
    "validFrom": null,
    "validUntil": null
  }],
  "source": "Independently authenticated operator channel",
  "confirmedAt": 0
}
```

Imported profiles require confirmation even if their JSON claims a prior confirmation time. Saving is explicit and respects the user's local-storage preference. Keys with duplicate IDs or invalid validity windows are rejected. Key fingerprints use SHA-256 over SPKI bytes. Changing evidence or trust clears prior conclusions and invalidates any verification still in progress.

For combined Insight review, separately supply and confirm the Insight key registry and `insight.protocol-trust.v1` configuration. The “Insight trust for a combined review” section accepts protocol JSON or a JSON file; an imported PriorSeal trust profile can also carry `insightKeyRegistry` and `insightProtocolTrust`. Importing either still requires independent confirmation. Changing keys or protocol evidence clears that confirmation and any old conclusion.

V5 checks its signed semantic profile, production environment and consumer-policy registry lineage. Historical v1–v4 semantics require exact preserved registry bytes, full SHA-256 and byte length; missing evidence stays partial. The complete two-sided manifest supports pre-trade v2/v3 with execution v3/v4/v5; a single-sided legacy execution cannot prove a two-sided workflow. See [the SDK protocol-trust shape and public discovery endpoints](../sdk/README.md#composite-review-manifests) for the precise required input and how to preserve snapshot bytes. A current registry does not replace missing historical evidence, and a manifest cannot choose its own trust policy.

Reports distinguish signature checks, independently supplied key trust, protocol scope and snapshot identity, cross-artifact relationships and pending chain checks. The selected offline policy is not a claim that a live partner route is currently active. Unsupported attachments remain partial. Contract-wallet current-state checks do not prove historical authorization. The external check plan is a handoff artifact; this offline UI does not silently complete RPC checks.

An imported file can be downloaded byte-for-byte. Edited/pasted JSON is exported as the current evidence text. Review reports describe local verification and do not alter signed receipts.

## Deployment capabilities and private archive

Quickstart reads `/v1/capabilities`: configured support is not a live availability guarantee. It shows audience, profile, supported chains, proof mode, dependency configuration and the selected workflow's compatibility. A published active key alone is insufficient to show readiness.

`/app/archive` is an optional, operator-configured private archive. Tokens remain in page memory and are excluded from storage and exports. Writer and reviewer permissions are enforced by the server. Searches use project/environment scope assigned by the token, snapshot pagination and explicit filters. You can export a page manifest or collect all artifacts using one server snapshot. Full browser exports are limited to 2,000 artifacts / 20 MiB and are cancellable; interrupted or bounded exports are explicitly marked partial. Uploads including their envelope are limited to 1 MiB. Uploads preserve existing records and can reference a superseded archive entry. Archived artifacts are not automatically verified, and the archive contains uploaded evidence only—not every public API object or execution.

Browser local activity remains available without an archive. See the in-app privacy page for the storage choice and deletion controls.

## Verification

`npx playwright test test/e2e/product-polish.spec.ts` exercises SDK-equivalent exact-call construction, stable acceptance retries, capability rejection, independent trust and custom audiences, scoped reviewer UI, partial manifests, original-byte export, real signed v5 combined review with protocol confirmation and snapshot mismatch rejection, uncertain observation recovery and mobile overflow. The existing `test/e2e/site.spec.ts` covers navigation, local storage, observation resumption and visual baselines. `npm run check:web-performance` enforces the unchanged bundle budgets; heavier verifier modules are loaded only when needed.

Browser tests use isolated synthetic data and mocked API responses; they do not perform live authorization, funds movement, or production deployment.
