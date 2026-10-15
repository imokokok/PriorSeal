# Solana mainnet integration

PriorSeal supports a bounded Solana mainnet-beta workflow: prepare a complete compiled transaction message, obtain a principal's Ed25519 message authorization, submit the transaction through your execution system, then observe the transaction and export the signed PriorSeal receipt.

This profile binds the complete versioned transaction message, not an interpretation of arbitrary program behavior. It supports legacy, v0, and v1 messages on Solana mainnet-beta and observes the confirmed commitment. `RPC_FINALIZED`, devnet, testnet, and semantic decoding of arbitrary instructions are not supported by this profile.

## Build the exact message intent

The transaction must be fully compiled before authorization. Set `messageVersion` to `legacy`, `v0`, or `v1` exactly as reported by the compiler. Resolve every address lookup table used by a v0 transaction and provide the resolved writable and readonly addresses in lookup order. A v1 message must include `transactionConfig` with its compute unit limit, loaded-account data limit, heap size, and total priority fee in lamports; v1 does not support address lookup tables. The intent commits to the version, configuration, fee payer, recent blockhash, message header, static account keys, lookup indexes and resolved addresses, plus each compiled instruction's program index, account indexes, and base58 data.

For Insight's signed pre-sign simulation, compute the intent message's canonical wire digest with the SDK's asynchronous `hashSolanaTransactionMessage(transaction)` helper. Submit the serialized transaction and that digest to Insight's `/api/v1/execution/solana/simulate` endpoint. Add the returned `contextCommitment` to the intent before authorization. Its namespace is `insight.solana-simulation-receipt.v1`, its algorithm is `sha256`, and its digest commits to the complete signed simulation envelope. The simulation must refer to the exact message that PriorSeal authorizes; changed blockhashes or instruction bytes require a new simulation and authorization.

The transaction `recentBlockhash` is the intent nonce because it is part of the message the transaction signatures cover. `lastValidBlockHeight` is returned separately by RPC and is not a field of the signed message, so it is not treated as an observed transaction fact.

```ts
import {
  createPriorSealClient,
  buildSolanaTransactionIntent,
  SOLANA_MAINNET_CAIP2,
} from 'priorseal-sdk'

const priorseal = createPriorSealClient({ baseUrl: 'https://priorseal.xyz' })
const capabilities = await priorseal.capabilities()

const intent = buildSolanaTransactionIntent({
  intentId: crypto.randomUUID(),
  asset: `${SOLANA_MAINNET_CAIP2}/slip44:501`, // native SOL
  amount: '1000000', // descriptive raw amount; instructions are bound independently
  validUntil: Math.floor(Date.now() / 1000) + 120,
  transaction: normalizedCompiledMessage,
})

const flow = await priorseal.authorizeWithSolanaWallet({
  intent,
  audience: capabilities.audience,
  principal: { type: 'user', id: 'user:42' },
  delegate: { agentId: 'agent:treasury', executor: intent.sender },
}, solanaWalletAdapter)

// Your application submits the already-authorized transaction.
const signature = await submitAuthorizedTransaction()
const evidence = await priorseal.observeExecutionUntilFinal({
  authorizationId: flow.accepted.authorization.authorizationId,
  chainId: 0,
  txHash: signature,
  confirmations: 0,
})
```

`normalizedCompiledMessage` has the `SolanaTransactionMessage` shape exported by the SDK. `solanaWalletAdapter` must expose its public key and `signMessage(Uint8Array)`, returning a 64-byte Ed25519 signature. The wallet signs PriorSeal's domain-separated authorization message; it does not sign or submit the transaction on behalf of the application. The principal wallet can differ from the transaction fee payer. The delegated executor must equal the fee payer.

Use a Solana mainnet asset identifier: `${SOLANA_MAINNET_CAIP2}/slip44:501` for SOL or `${SOLANA_MAINNET_CAIP2}/spl:<mint-public-key>` for an SPL asset. The asset and amount are descriptive policy fields; PriorSeal does not infer them by decoding arbitrary Solana instructions.

## Configure observation

Set `PRIORSEAL_RPC_SOLANA_MAINNET` to one or more comma-separated Solana mainnet-beta JSON-RPC endpoints. The observer checks each endpoint's genesis hash against mainnet-beta, then reads signature status, transaction message, loaded lookup addresses, and slot metadata. An exact match compares the complete compiled message. Reverted, pending, missing, and message-mismatch observations remain distinct in the receipt.

Solana execution fees and compute units are recorded as available RPC facts. Token transfers and program-level intent semantics are not inferred. Receipts remain signed by the configured PriorSeal issuer; the issuer signature authenticates the evidence package, while the RPC remains the source of the chain observation. Establish trust in the issuer key separately from a downloaded bundle.

## Inspect support

Read `GET /v1/capabilities` before wallet signing. A configured `chainReadiness` entry with `chainId: 0` reports RPC configuration, not endpoint reachability. The profile and `solana-ed25519` authorizer appear when the deployment policy permits the Solana transaction action.

The SDK verifier checks the Ed25519 authorization and recomputes the signed intent, execution, policy, and authorization-binding results offline. It validates the v1 resource configuration as part of the message commitment. It cannot turn a configured RPC observation into an independent consensus proof.
