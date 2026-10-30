# Guarded Action integration

`WalletGuardedAction` is PriorSeal's narrow, serializable integration layer for
one action: risk decision, exact authorization, one recorded submission, one
or more observations of that original transaction, then receipt verification.
It does not hold keys, construct an arbitrary transaction, initiate payment, or
retry a submission.

## What an integrator owns

The service operator owns its API credential, durable state store, user-facing
review screen, and transaction executor. Browser and chat clients receive only
the public action summary, the exact canonical fields, a wallet request, and
the final receipt. Do not put a PriorSeal API credential, an executor key, or a
wallet key in browser code, MCP instructions, or a user prompt.

## Minimal server flow

```ts
import {
  createWalletGuardedAction,
  transitionWalletGuardedAction,
  summarizeWalletGuardedAction,
} from 'priorseal-sdk'

let action = createWalletGuardedAction({ actionId, intentId, chainId: 8453 })
action = transitionWalletGuardedAction(action, {
  type: 'RISK_EVALUATED',
  verdict: insightDecision.guard.verdict, // BLOCK stops here
  decisionId: insightDecision.decisionHash,
})
action = transitionWalletGuardedAction(action, { type: 'AUTHORIZATION_PREPARED' })
await actionStore.save(action)

// The principal signs through an injected EIP-712 signer. The SDK receives no
// private key. Persist every checkpoint with the existing authorization flow.
action = transitionWalletGuardedAction(action, { type: 'AUTHORIZATION_SIGNATURE_REQUESTED' })
const accepted = await priorSeal.authorizeWithEip712Signer(authorizationInput, principalSigner, { onCheckpoint: saveCheckpoint })
action = transitionWalletGuardedAction(action, { type: 'AUTHORIZATION_ACCEPTED', result: accepted })
await actionStore.save(action)

// Call the integrator's executor exactly once. On an uncertain delivery result,
// record UNKNOWN and reconcile the original hash; never call it again.
const { txHash } = await executor.submitExactCallOnce(accepted.accepted.authorization)
action = transitionWalletGuardedAction(action, { type: 'SUBMISSION_RECORDED', txHash })
action = transitionWalletGuardedAction(action, { type: 'OBSERVATION_STARTED' })
const observation = await priorSeal.observeExecutionUntilFinal({
  authorizationId: accepted.accepted.authorization.authorizationId,
  chainId: 8453,
  txHash,
})
action = transitionWalletGuardedAction(action, { type: 'OBSERVATION_RECORDED', result: observation })
await actionStore.save(action)

return summarizeWalletGuardedAction(action)
```

Only after `OBSERVED` should the integrator independently verify the receipt
with its selected issuer-key trust anchor, then dispatch
`VERIFICATION_RECORDED`. The action is then `VERIFIED` only if that verification
passes and the receipt ID matches the observed record.

## Base Aave V3 focus

For the current beachhead, use `buildBaseLendingGuardBoundIntent()` after
`verifyInsightBaseLendingGuardDecision()` accepts a fresh `ALLOW` decision. The
decision binds the exact Base direct call. A generic Wallet MCP swap, a batch,
an approval plus swap, a UserOperation, or ERC-1271 signature is out of scope
for this profile and must stop at assessment or use a separately reviewed
integration.

## UI requirements

Render `summarizeWalletGuardedAction(action)` verbatim or equivalently. The UI
must show the exact call before the authorization signature, separate the
authorization signature from transaction submission, retain the original hash,
and show `UNKNOWN` as a reconciliation state—not a retry button. The web
console exports a presentation-only `GuardedActionCard` implementation for
integrators that use its React component set.
