# Lifecycle and state model

| Entity | Immutable fields | Mutable/lifecycle fields |
| --- | --- | --- |
| Intent | canonical fields and `intentHash` | none; create a new intent to change authorization |
| Authorization | complete intent, principal, authorizer, delegate, time window, nonce, audience, policy hash and signature | `ACCEPTED → BOUND`; a pending correlated transaction is only a candidate, and only a confirmed or reverted transaction on the signed chain whose sender and transaction nonce match the delegated executor and intent can consume its single use |
| Authorization log entry | sequence, authorization hash, acceptance time, predecessor and entry hash | immutable; later checkpoints extend the hash chain |
| RFC 3161 evidence | authorization imprint, trusted time, TSA policy/serial, nonce, signed response and profile | immutable; rejected if the signed token or metadata changes |
| Observation | each observation record | later observations append a new version; never overwrite prior evidence |
| Binding | all result fields | recomputed only for a new receipt/observation |
| Receipt | entire signed payload | never mutate; a reorg is a new receipt with `REORGED` outcome |
| Key | public identity/key material | registry status and validity window; never change key material under a key ID |
| Job | input and idempotency key | `QUEUED → RUNNING → RETRY_WAIT → COMPLETED|UNDETERMINED|FAILED` |

Observation state: `PENDING`, `NOT_FOUND`, `RPC_ERROR`, and `RPC_TIMEOUT` are retryable/undetermined; they are not failures. `REVERTED` is a chain execution failure. Re-observing a transaction compares the latest stored observation; a changed confirmed `blockHash`, or disappearance after prior inclusion, is `REORGED` and produces a new receipt. In receipt v3, `outcome` describes execution state while `compliance.status` independently reports `COMPLIANT`, `NON_COMPLIANT`, or `NOT_ASSESSABLE`. Only a final execution correlated by chain, delegated executor and nonce can be compliant or non-compliant. Insufficient evidence, pending finality, a reorg, or an unrelated transaction remains not assessable. Receipt v2 keeps its historical rule that `COMPLETED` implies a successful binding.

`Intent.validUntil` applies to `execution.executedAt`, which is the containing block timestamp. It is not a receipt expiration date. Verification evaluates the receipt signature and the issuer key's validity at `issuedAt`, so retained receipts remain verifiable after the intent window closes.

An intent is only a proposal. V2 authority begins when the named principal account signs the EIP-712 authorization and PriorSeal accepts it. In RFC 3161 mode, acceptance is not persisted until DigiCert signs the authorization imprint; execution additionally requires that trusted timestamp to be no later than the containing block timestamp. If `acceptance.acceptedAt` is later than the containing block timestamp, a v3 receipt is valid evidence of a completed but `NON_COMPLIANT` execution with `AUTHORIZATION_AFTER_EXECUTION`; a v2 receipt retains its historical `UNDETERMINED` outcome.
