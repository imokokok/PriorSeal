# Reviewed single-pool ERC-20 swap authorization

This opt-in workflow makes one supported swap's business fields visible before the principal signs a PriorSeal exact-call authorization. It preserves PriorSeal's evidence role: the customer's wallet or execution system signs and broadcasts the transaction, and PriorSeal later observes it. Insight may supply a separately verified oracle risk assessment; this adapter does not make one mandatory or reinterpret Insight's verdict.

## Supported call

- One EVM chain and one externally reviewed deployment of the **original Uniswap V3 SwapRouter** `exactInputSingle` selector with the deadline inside its tuple.
- ERC-20 input and output, exact input, one pool fee, one output recipient, zero native value and `sqrtPriceLimitX96 = 0`.
- A fixed transaction sender, nonce, router target and canonical calldata. Router runtime bytecode must match an independently pinned hash at authorization review and again at the signing or submission boundary.
- The approved maximum input and minimum output are expressed in **atomic token units**. The concrete call may spend no more than the approved maximum and require no less than the approved minimum. The current console derives both limits exactly from the imported call.

SwapRouter02, Universal Router, multicall, split routes, native swaps, exact-output calls, fee-on-transfer tokens and arbitrary selectors require separate reviewed adapters. Supplying a code hash from the transaction proposer does not establish that the router is trusted. Review the deployment, its code and upgradeability, then provision the hash through a trusted configuration. For a proxy, pinning only the proxy runtime code does not pin its implementation.

## SDK flow

```ts
import {
  createV3SwapApproval, buildV3SwapIntent, assertV3SwapAuthorization,
  createPriorSealClient,
} from 'priorseal-sdk'

// tx is the complete transaction built by the customer's execution system.
const approval = createV3SwapApproval(tx, reviewedRouterCodeHash)
// Display every approval field to the principal before requesting a signature.
const intent = buildV3SwapIntent({
  approval, transaction: tx, intentId, validUntil,
  constraints: { minConfirmations: 12 },
})
const client = createPriorSealClient({ baseUrl: priorSealBaseUrl })
const flow = await client.authorizeWithWallet({
  intent, principal, delegate, account: principalAccount,
}, walletProvider)

// Put this immediately before every wallet signing/submission path. Obtain
// current bytecode from the intended chain and independently admitted RPC.
assertV3SwapAuthorization({
  approval, transaction: tx,
  intent: flow.accepted.authorization.intent,
  routerBytecode: await publicClient.getCode({ address: approval.router }),
})
// The customer's wallet/executor now signs and sends the SAME exact tx.
```

The helper rejects changed tokens, recipient, router, pool fee, spend, minimum output, deadline, nonce, calldata, native value, signed approval commitment and router runtime code. It also refuses an expired authorization window. The calling system must verify that the PriorSeal authorization was accepted and route **all** signing and broadcast paths through this guard; a code path that bypasses it is outside this protection. ERC-20 `approve` is a separate transaction with its own spender and allowance scope; review and authorize it independently when required.

The console's **Review as a single-pool ERC-20 swap** mode decodes these fields from an imported transaction, checks the wallet chain and router code, compares the server-prepared intent before signing, and exports the original approval and transaction with the accepted authorization. A swap recovery checkpoint packages the approval and transaction so importing it can recheck the signed intent. A signed checkpoint recovered after expiry may recover an existing acceptance; it does not grant permission to execute a new trade.

## Evidence and limits

The existing `priorseal.intent.v2` exact-call profile remains the signed protocol. The adapter adds a `priorseal.swap-approval.v1` context commitment over a strictly normalized approval object. The signed intent also binds chain, sender, nonce, target, calldata hash, native value and validity. A reviewer should verify the PriorSeal receipt with an independently trusted issuer key, retrieve the transaction identified by its hash, and then run `assertV3SwapAuthorization` over the retained approval and actual transaction. For historical review, pass the independently checked execution time as `now` and check router bytecode at the execution block; current `latest` code alone cannot establish historical implementation identity. A compliant exact-call receipt establishes that the observed transaction matched the signed call; it does not independently prove actual token balances, token behavior, best execution or economic safety. Verify the actual output and recipient against trusted on-chain evidence separately.

The local end-to-end check uses an isolated EVM and valueless test tokens. With a local Ganache 7.9.2 installation:

```sh
GANACHE_MODULE=/absolute/path/to/ganache/dist/node/core.js npm run swap:execution:check
```

It accepts a user-signed authorization through the PriorSeal HTTP API, rejects a changed recipient, mines the guarded transaction, observes it through the API, independently verifies the signed receipt and checks the recipient's test-token balance. The simulated router is not a production Uniswap deployment.
