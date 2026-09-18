# Web3 Agent Kit canonical call binding

Web3 Agent Kit v1.18.1 defines `CallEnvelopeV1` under the hash domain
`agent-call-envelope.v1`. PriorSeal accepts that envelope digest directly as a
namespaced `contextCommitments` entry. It does not parse the WAK envelope,
normalize its fields again, or hash the digest a second time.

## Binding contract

The WAK-produced value enters a `priorseal.intent.v2` exact-call intent as:

```json
{
  "namespace": "agent-call-envelope.v1",
  "algorithm": "sha256",
  "digest": "0x...the exact WAK CallEnvelopeV1 digest..."
}
```

The policy verdict remains a different fact and, when carried, uses its own
entry:

```json
{
  "namespace": "web3-agent-kit.policy-decision.v1",
  "algorithm": "sha256",
  "digest": "0x...the WAK policy-decision digest..."
}
```

This preserves one call identity while keeping “policy allowed” distinct from
“the principal authorized this exact call.”

Use the SDK helper to make the no-rehash rule explicit:

```ts
import {
  buildExactCallIntent,
  matchWeb3AgentKitCallEnvelope,
  web3AgentKitContextCommitments,
} from '@priorseal/sdk'

const contextCommitments = web3AgentKitContextCommitments({
  callEnvelopeDigest: wakResult.callFingerprint,
  policyDecisionDigest: wakResult.policyCommitment.digest,
})

const intent = buildExactCallIntent({
  transaction,
  intentId,
  asset,
  amount,
  validUntil,
  contextCommitments,
})

const binding = matchWeb3AgentKitCallEnvelope(intent, wakResult.callFingerprint)
if (!binding.matched) throw new Error(binding.code)
```

## Single source of truth

WAK owns the canonical envelope bytes and their SHA-256 digest. The shared v1
contract is:

- domain label: `agent-call-envelope.v1`, followed by a zero byte;
- canonical JSON: keys sorted, UTF-8, no insignificant whitespace;
- fields: `schema`, `chainId`, `executionProfile`, `executor`, decimal-string
  `nonce`, `calldataHash`, decimal-string `nativeValue`, and `target` for a
  normal call;
- address spelling: lowercase 20-byte EVM addresses;
- calldata: Keccak-256 of the exact raw calldata bytes;
- call digest: SHA-256 over the domain label, zero byte, and canonical JSON.

PriorSeal treats the result as an opaque external digest. Lowercasing its hex
spelling is not a semantic transformation and does not change the bytes. Any
change to the field set, normalization rules, encoding, domain label, or hash
algorithm requires a new namespace/version rather than silent translation.

PriorSeal independently builds its signed exact-call intent from the same
fully constructed transaction. Its `chainId`, delegated executor, nonce, call
target, calldata hash and native value must agree with the WAK envelope. A
composition adapter must fail closed if that parity check fails.

Contract creation is outside PriorSeal's current
`priorseal.execution-profile.exact-call.v1`, which requires a target address.
Do not translate WAK's `executionProfile: "create"` into a normal call.

## Authority and custody boundary

The WAK policy decision is advisory to the principal authorization boundary;
policy allow never substitutes for PriorSeal authorization. PriorSeal v2 signs
principal authorizer and delegated executor as separate roles, and deployments
may require different addresses. Neither product can infer custody separation
from different addresses: key storage, HSM/MPC, process isolation, access
control and recovery remain integrator responsibilities.
