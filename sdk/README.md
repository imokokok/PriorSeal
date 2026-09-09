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
})

if (!result.valid) console.error(result.code)
if (result.requiredExternalChecks.length) {
  console.log('Additional chain-state checks:', result.requiredExternalChecks)
}
```

The verifier performs no network requests. It recomputes canonical intent, authorization and execution hashes, policy results, binding reason codes, outcomes and identifiers; it also checks EIP-712 EOA, Ed25519, RFC 3161, witness and transparency-chain evidence. ERC-1271 signatures and EVM anchor inclusion require chain state and are returned in `requiredExternalChecks` rather than being treated as offline facts.

`verifyReceiptRemotely` remains available as a convenience API call, but it is not independent verification.

Portable bundles are available with `getVerificationBundle(receiptId)`. Verify them with `verifyVerificationBundleLocally(bundle, { trustedKeys })`; `trustedKeys` must come from an independently pinned source, never from `bundle.keyRegistry` alone.

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
