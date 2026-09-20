# Insight + PriorSeal RWA v1 local verification

Unreleased opt-in integration. This example uses fixed simulation inputs, public
test EIP-712 keys and an ephemeral Ed25519 receipt key. It makes no network calls,
persists no private key and sends no transaction.

From the two repository roots:

```sh
npm --prefix ../insight run sdk:build
npm run sdk:build
node examples/rwa-v1/verify.mjs ../insight
```

The last argument is the Insight checkout path; the sibling checkout is the default.
The script checks vendored source parity, cross-SDK signatures, principal authorization,
fresh execution evidence, exact transaction matching, replay rejection and a signed
PriorSeal v3 receipt. It then rejects an execution-time halt, receipt tampering,
missing issuer trust and a simulation proof under production trust.

## Application integration

1. Obtain an authenticated and signed assessment. Supply independent policy/key
   pins to `buildRwaBoundIntent(exactCallInput, {proof, trust}, now)`.
2. Request principal authorization using the existing PriorSeal client. Confirm
   that the accepted intent equals the locally built intent, including commitments.
3. Obtain a distinct, newer assessment of the **same request and pinned policy**.
4. At the actual transaction signer entry, call `withRwaExecutionPair(pair,
   actualTransaction, callback, clock)`. The callback must also enforce principal
   authorization, contract/action semantics and atomic nonce/replay reservation.
   Do not switch to an unguarded signer if this call rejects.
5. Observe the actual transaction with the existing PriorSeal workflow.
6. Archive `{receipt, authority, execution}`. Use
   `verifyRwaReceiptBundle(bundle, independentlyConfiguredRwaTrust, receiptOptions)`
   from the SDK or browser verifier. Receipt options must supply the issuer key
   out-of-band. Acceptance/execution times and call binding come from the verified
   receipt, not untrusted bundle timestamps.

For workflows that explicitly permit only the original still-fresh assessment,
`withRwaBoundIntent` rechecks that report and actual transaction. It does **not**
fetch new market state. Prefer the execution-pair helper for equity trading.

The intent carries `insight.rwa.assessment.v1` with the authority report digest and
preserves other commitments. Its expiry cannot outlive the report. New execution
evidence is kept separate; it is not backdated into the principal's original
authorization. Pair verification proves signed evidence consistency, not that
an external agent actually ran this guard. Short TTLs also cannot eliminate market
changes after callback entry or during blockchain inclusion.

Core receipts and old authorization schemas have not changed. This layer is not
an on-chain compliance contract, a broker/order router, a custody audit, a fill
price verifier or a legal ownership attestation. Existing Agent/DeFi checks stay
in place; production source authentication, signer operations, receiver restrictions,
atomic replay protection, chain finality and issuer controls remain required.

The sample's `0x1234` call is an arbitrary simulated exact call, **not a stock
purchase contract ABI**. CONFIRMED execution in the example is a synthetic observer
assertion used to test signatures and binding. No live execution is claimed.

See [implementation plan](../../docs/rwa-adaptation-plan.md) and
[validation record](../../docs/rwa-validation.md).
