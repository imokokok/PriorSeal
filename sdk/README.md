# priorseal-sdk

Typed browser and Node.js client for the PriorSeal authorization and execution-evidence API. It never receives a transaction-signing key and does not submit asset transfers.

```bash
npm install priorseal-sdk
```

## Client

```ts
import { createPriorSealClient } from 'priorseal-sdk'

const priorseal = createPriorSealClient({ baseUrl: 'https://priorseal.xyz' })
const flow = await priorseal.authorizeWithWallet({
  intent,
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

Portable bundles are available with `getVerificationBundle(receiptId)`. Verify them with `verifyVerificationBundleLocally(bundle, { trustedKeys })`; `trustedKeys` must come from an independently pinned source, never from `bundle.keyRegistry` alone.

## Deployment capabilities and resumable authorization

Read `await priorseal.capabilities()` before preparing a workflow. Check its audience, execution profile, chosen chain's `chainReadiness`, and `workflowReady`. Capabilities report configuration and storage; they do not probe live RPC/TSA availability or replace request-specific policy checks.

```ts
const flow = await priorseal.authorizeWithWallet(request, wallet, {
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
})
```

Trust profiles use `schema: 'priorseal.trust-profile.v1'`, issuer, audience, keys, source and `confirmedAt` in Unix seconds. Zero means unconfirmed. Optional Insight registries must also come from an independently established source. The browser asks for confirmation separately; a profile's self-declared timestamp does not confer trust.

The manifest preserves raw attachment bytes and SHA-256 hashes. Supported native Insight roles are `insight.source`, `insight.destination` and `insight.execution`; profiles are `insight.pretrade.v2/v3` and `insight.execution.v2/v3/v4`. A complete two-sided composition requires a destination-bound execution receipt (v3 or v4), both pre-trade receipts and an independently trusted production signer. A legacy v2 execution cannot establish a two-sided pair.

Verification checks each native signature, the paired UIDs, the context commitment, authorization time coverage, transaction hash, settlement chain, execution time and executor identity. A manifest hint cannot override the signed PriorSeal transaction. The result keeps signature/integrity/trust checks, cross-evidence relations and required external chain-state checks separate. Unknown attachments remain preserved and explicitly unverified; missing evidence, sample keys or unresolved external checks cannot produce a complete green result. An old but correctly signed assessment can be valid historical evidence without being usable for a new execution.

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
