# priorseal-sdk

Workspace-only, unreleased: [RWA exact-call binding and combined receipt verification](../examples/rwa-v1/README.md).
These opt-in additions are not yet in the published 0.6.0 package and do not alter
existing authorization or receipt semantics.
RWA v2 adds linked same-second assessments, admitted calldata/receiver checks and
`inspectRwaReceiptBundle` for separate integrity/trust/time/policy/execution results.
For safe submission use the Node application entry described in
[RWA v2 hardening](../docs/rwa-hardening.md); SDK low-level callbacks alone do not
enforce principal authorization or durable replay protection.

Typed browser and Node.js client for the PriorSeal authorization and execution-evidence API. It never receives a transaction-signing key and does not submit asset transfers.

```bash
npm install priorseal-sdk@0.6.0
```

This documentation targets **0.6.0**, available from npm. The identical published tarball is also available from the [official GitHub Release](https://github.com/imokokok/PriorSeal/releases/tag/sdk-v0.6.0). The release adds independently verified Insight coverage binding for exact-call authorization and includes compiled JavaScript, TypeScript declarations and third-party license notices.

## Client

```ts
import { createPriorSealClient } from 'priorseal-sdk'

const priorseal = createPriorSealClient({ baseUrl: 'https://priorseal.xyz' })
const capabilities = await priorseal.capabilities()
const flow = await priorseal.authorizeWithWallet({
  intent,
  audience: capabilities.audience,
  principal: { type: 'user', id: 'user:42' },
  delegate: { agentId: 'agent:treasury', executor: intent.sender },
}, window.ethereum)

const evidence = await priorseal.observeExecutionUntilFinal({
  authorizationId: flow.accepted.authorization.authorizationId,
  chainId: Number(intent.chainId),
  txHash,
  confirmations: 12,
})
```

## Independent local verification

```ts
import { verifyReceiptLocally } from 'priorseal-sdk/verifier'

const result = await verifyReceiptLocally(receipt, {
  trustedKeys: keyRegistry,
  expectedAudience: 'your-deployment-audience',
})

if (!result.valid) console.error(result.code)
if (result.requiredExternalChecks.length) {
  console.log('Additional chain-state checks:', result.requiredExternalChecks)
}
```

The verifier performs no network requests. It recomputes canonical intent, authorization and execution hashes, policy results, binding reason codes, outcomes and identifiers; it also checks the authorization against `expectedAudience` (defaulting to `priorseal`) and verifies EIP-712 EOA, Ed25519, RFC 3161, witness and transparency-chain evidence. Set the deployment-specific audience explicitly in production. ERC-1271 signatures and EVM anchor inclusion require chain state and are returned in `requiredExternalChecks` rather than being treated as offline facts.

`verifyReceiptRemotely` remains available as a convenience API call, but it is not independent verification.

Portable bundles are available with `getVerificationBundle(receiptId)`. Verify them with `verifyVerificationBundleLocally(bundle, { trustedKeys: confirmedTrust.keys, expectedAudience: confirmedTrust.audience })`; both values must come from your independently confirmed trust configuration, never from `bundle.keyRegistry` or the receipt alone. The hosted deployment currently uses `priorseal.xyz`; do not assume the SDK's compatibility default `priorseal` matches a deployment.

## Deployment capabilities and resumable authorization

Read `await priorseal.capabilities()` before preparing a workflow. Check its audience, execution profile, chosen chain's `chainReadiness`, and `workflowReady`. Capabilities report configuration and storage; they do not probe live RPC/TSA availability or replace request-specific policy checks.

```ts
const capabilities = await priorseal.capabilities()
const flow = await priorseal.authorizeWithWallet({ ...request, audience: capabilities.audience }, wallet, {
  onCheckpoint: async checkpoint => {
    await yourPrivateStore.save(JSON.stringify(checkpoint))
  },
})

// After a lost acceptance response or process restart:
const checkpoint = JSON.parse(await yourPrivateStore.load())
const recovered = await priorseal.authorizeWithWallet(checkpoint.request, wallet, {
  checkpoint,
  onCheckpoint: value => yourPrivateStore.save(JSON.stringify(value)),
})
if (!recovered.authorizationWindow.active) {
  console.log(recovered.nextAction) // History recovery never renews permission.
}
```

Supply the deployment's audience explicitly in `request.audience`; the SDK default is `priorseal`. Checkpoints contain public signed artifacts, an operation idempotency key and potentially sensitive intent metadata. Choose appropriate storage and access controls. They do not contain wallet private keys.

Before requesting a signature, the helper checks the checkpoint/request identities, intent, time limits, audience and single-use scope, recomputes intent/authorization hashes, reconstructs typed data locally and compares it with the prepared response. It verifies the returned EIP-712 signature before acceptance. A signed recovery replays exactly the existing authorization and idempotency key; it does not ask for a second signature or submit a transaction. The service may reject an expired, previously unaccepted operation. A recovered historical acceptance can have `authorizationWindow.active === false`; it is not dispatch permission. The final executor still owns submission-time policy checks.

An `OBSERVATION_WAIT_TIMEOUT` error includes `details.jobId`, `authorizationId`, `txHash` and the last job when known. Resume with `waitForObservationJob(jobId)`; a client wait timeout does not prove that the transaction failed. Preserve unknown, pending, undetermined and reorg evidence instead of automatically broadcasting again.

## Composite review manifests

```ts
import {
  buildReviewManifest,
  parseTrustProfile,
  verifyReviewManifestLocally,
} from 'priorseal-sdk/verifier'

const manifest = await buildReviewManifest({
  bundle: await priorseal.getVerificationBundle(receiptId),
  attachments, // [{ id, role, profile, rawJson }]; retain the original JSON bytes.
  expectedTxHash: txHash,
})
const profile = parseTrustProfile(independentlyObtainedProfile)
// Parsing validates shape, not provenance. Confirm the trust source independently.
const review = await verifyReviewManifestLocally(manifest, {
  trustedKeys: { schema: 'priorseal.keys.v1', issuer: profile.issuer, keys: profile.keys },
  expectedAudience: profile.audience,
  insightKeyRegistry: profile.insightKeyRegistry,
  insightProtocolTrust: profile.insightProtocolTrust,
})
```

Trust profiles use `schema: 'priorseal.trust-profile.v1'`, issuer, audience, keys, source and `confirmedAt` in Unix seconds. Zero means unconfirmed. Optional Insight registries must also come from an independently established source. The browser asks for confirmation separately; a profile's self-declared timestamp does not confer trust.

The manifest preserves raw attachment bytes and SHA-256 hashes. Supported native Insight roles are `insight.source`, `insight.destination` and `insight.execution`; profiles are `insight.pretrade.v2/v3` and `insight.execution.v2/v3/v4/v5`. A complete two-sided composition requires a destination-bound execution receipt (v3–v5), both pre-trade receipts, independently trusted production attester keys, and independently pinned Insight protocol evidence. A legacy v2 execution cannot establish a two-sided pair. Unknown versions and semantic profiles remain unverified.

`insightProtocolTrust` is caller configuration, never a trust root taken from the manifest. V5 requires the signed supported `profileId`, the production environment, immutable release/profile bodies and a consumer policy admitting the release through its predecessor lineage. Every release up to an admitted floor must be supplied and content-addressed correctly; missing ancestry, mismatched content or unadmitted profiles fail closed. This proves the selected offline policy, not that a partner policy is currently active on the live service.

Legacy v1–v4 do not sign `profileId`. Their semantic review requires the exact independently preserved registry UTF-8 bytes, full SHA-256 and byte length. The result is relative to that snapshot, never a globally canonical legacy verdict. Missing or mismatched historical snapshots stay incomplete; a current registry cannot silently substitute for historical evidence. The manifest's two-sided support remains v3/v4 for these historical layouts.

Minimal protocol-trust shape (placeholders must be replaced with independently reviewed values):

```ts
const insightProtocolTrust = {
  schema: 'insight.protocol-trust.v1',
  registrySnapshot: {
    rawJson: exactRegistryText, // Preserve the downloaded bytes; do not parse/re-serialize.
    sha256: independentlyConfirmedFullSha256,
    byteLength: independentlyConfirmedUtf8ByteLength,
  },
  registryReleases: [
    { releaseId: selectedReleaseId, rawJson: exactReleaseResponse },
    // Include every predecessor down to a policy-admitted floor, including that floor.
  ],
  executionProfiles: [{ profileId: signedProfileId, rawJson: exactProfileResponse }],
  consumerPolicy: {
    allowedSchemaVersions: [5],
    allowedProfileIds: [signedProfileId],
    registryReleaseIds: independentlySelectedReleaseFloors,
    policyId: independentlySelectedPolicyId,
    policyRawJson: exactPolicyResponse,
  },
}
```

The optional `policyId` and `policyRawJson` must be supplied together; the immutable policy's hash and pins must agree with the explicit consumer pins. A caller-owned policy can instead omit both and independently choose its schema/profile/release pins. Importing or hashing a document does not establish that its source or policy is appropriate for the reviewer.

Public discovery starts at `https://www.oracleinsight.xyz/.well-known/oracle-keys.json` for the key registry/snapshot. Obtain immutable bodies from `/.well-known/oracle-registry/releases/{releaseId}`, `/.well-known/oracle-registry/profiles/{profileId}` and `/.well-known/oracle-registry/integrations/{policyId}` on that same origin. Each release's `predecessorReleaseId` identifies the next required body. Preserve the actual response text and independently confirm the expected key identities, snapshot digest/byte length and policy; do not accept values merely because the evidence file supplies them. Use the independently trusted snapshot's `public_keys`/`revoked_keys` as `insightKeyRegistry`. Insight defines an omitted key role as the legacy default `attester`; explicit `sample` or unknown roles cannot establish production trust.

For a locally preserved `oracle-keys.json`, `sha256sum oracle-keys.json` and `wc -c < oracle-keys.json` report the exact file digest/length. On macOS, use `shasum -a 256 oracle-keys.json`. These values identify the preserved file; they still need provenance review. The same protocol-trust object can be included in a `priorseal.trust-profile.v1` profile or entered separately in the console.

Verification checks each native signature, the paired UIDs, the context commitment, authorization time coverage, transaction hash, settlement chain, execution time and executor identity. A manifest hint cannot override the signed PriorSeal transaction. The result keeps signature/integrity/key-trust checks, `artifacts[].protocol` (scope, snapshot digest/length, release and policy), cross-evidence relations and required external chain-state checks separate. Unknown attachments remain preserved and explicitly unverified; missing evidence, sample keys or unresolved external checks cannot produce a complete green result. An old but correctly signed assessment can be valid historical evidence without being usable for a new execution.

The optional Headless verifier described below remains independently callable. Arbitrary partner attachments are not automatically promoted to a supported verification profile by including them in a manifest.

## Exact contract calls

Use intent v2 when an integration already constructs the exact transaction and another system owns its business semantics:

```ts
import { buildExactCallIntent, matchUniqueContextCommitment } from 'priorseal-sdk'

const intent = buildExactCallIntent({
  transaction: { chainId: 8453, from: executor, to: router, data, value: 0n, nonce: 17n },
  intentId: 'swap-42',
  asset: 'eip155:8453/erc20:0x…',
  amount: 1000000n,
  validUntil,
  constraints: { minConfirmations: 12 },
  contextCommitments: [{
    namespace: 'example.quote-approval.v1',
    algorithm: 'keccak256',
    digest: quoteApprovalDigest,
  }],
})

const assessmentReference = matchUniqueContextCommitment(intent, {
  namespace: 'example.quote-approval.v1',
  algorithm: 'keccak256',
  digest: quoteApprovalDigest,
})
```

The profile binds chain, executor, nonce, target, calldata, native value, time, finality and any namespaced external context digests. It intentionally ignores transfer-log recipient/asset/amount matching and transfer-count ambiguity, so a swap-specific verifier can grade fills without PriorSeal pretending to understand router semantics.

`matchUniqueContextCommitment` confirms that exactly one commitment in the
namespace matches the expected external digest. Verify the containing
authorization or receipt separately to establish who approved it. The external
system remains authoritative for the digest's business meaning and may treat it
as an advisory recommendation rather than an execution permission. Use
`matchContextCommitment` when a protocol deliberately permits several
commitments in the same namespace.

## Short-window market-state evidence

The SDK includes an offline verifier for Headless Oracle v5 market-state receipts. For a short validity window, use two receipts with different evidence roles: bind the authority-time receipt digest into the signed intent, then independently verify and retain a distinct execution-time receipt in the final evidence bundle.

```ts
import { verifyHeadlessMarketStateReceiptPair } from 'priorseal-sdk'

const result = await verifyHeadlessMarketStateReceiptPair({
  intent,
  authorityReceipt,
  executionReceipt,
  key: pinnedHeadlessIssuerKey,
  authorityTime,
  executionTime,
  policy: { expectedMic: 'XNYS', allowedStatuses: ['OPEN'], requiredFeedState: 'live' },
})
```

The default accepts only `live` receipt mode. Opting into `demo` is explicit and suitable only for fixtures. The verifier makes no network requests and reports signature, commitment, key, time-window, venue, mode, status, coverage, uniqueness, and pair-timeline failures. The execution-time digest is deliberately returned as `executionEvidenceCommitment`; it is not claimed to have existed in the earlier authorization.
