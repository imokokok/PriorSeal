# priorseal-sdk

Typed browser and Node.js client for the PriorSeal authorization and execution-evidence API. It never receives a transaction-signing key and does not submit asset transfers.

```bash
npm install priorseal-sdk
```

```ts
import { createPriorSealClient } from 'priorseal-sdk'

const priorseal = createPriorSealClient({ baseUrl: 'https://priorseal.example' })

const flow = await priorseal.authorizeWithWallet({
  intent,
  principal: { type: 'user', id: 'user:42' },
  delegate: { agentId: 'agent:treasury', executor: intent.sender },
}, window.ethereum)

const result = await priorseal.observeExecution({
  authorizationId: flow.accepted.authorization.authorizationId,
  chainId: Number(intent.chainId),
  txHash,
  confirmations: 12,
})

console.log(result.receipt)
```

`getTransparencyEvidence` retrieves the signed log proof, while `getObservationJob` follows automatic finality work. `verifyReceiptRemotely` calls the convenience HTTP verifier. For independent assurance, use the browser verifier in the PriorSeal console or the repository CLI and a trusted issuer public key.
