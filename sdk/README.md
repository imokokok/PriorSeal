# priorseal-sdk

Typed browser and Node.js client for the PriorSeal authorization and execution-evidence API. It never receives a transaction-signing key and does not submit asset transfers.

```bash
npm install priorseal-sdk
```

## Client

```ts
import { createPriorSealClient } from 'priorseal-sdk'

const priorseal = createPriorSealClient({ baseUrl: 'https://priorseal.example' })
const flow = await priorseal.authorizeWithWallet({
  intent,
  principal: { type: 'user', id: 'user:42' },
  delegate: { agentId: 'agent:treasury', executor: intent.sender },
}, window.ethereum)

const evidence = await priorseal.observeExecution({
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

## Exact contract calls

Use intent v2 when an integration already constructs the exact transaction and another system owns its business semantics:

```ts
const intent = {
  schema: 'priorseal.intent.v2',
  executionProfile: 'priorseal.execution-profile.exact-call.v1',
  intentId: 'swap-42',
  chainId: 8453,
  action: 'CONTRACT_CALL',
  asset: 'eip155:8453/erc20:0x…',
  amount: '1000000',
  sender: executor,
  recipient: router,
  validUntil,
  nonce: '17',
  callTarget: router,
  calldataHash,
  transactionValue: '0',
  constraints: { minConfirmations: 12 },
}
```

The profile binds chain, executor, nonce, target, calldata, native value, time and finality. It intentionally ignores transfer-log recipient/asset/amount matching and transfer-count ambiguity, so a swap-specific verifier can grade fills without PriorSeal pretending to understand router semantics.
