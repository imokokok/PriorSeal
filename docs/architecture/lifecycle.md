# Lifecycle and state model

| Entity | Immutable fields | Mutable/lifecycle fields |
| --- | --- | --- |
| Intent | canonical fields and `intentHash` | none; create a new intent to change authorization |
| Observation | each observation record | later observations append a new version; never overwrite prior evidence |
| Binding | all result fields | recomputed only for a new receipt/observation |
| Receipt | entire signed payload | never mutate; a reorg is a new receipt with `REORGED` outcome |
| Key | public identity/key material | registry status and validity window; never change key material under a key ID |
| Job | input and idempotency key | `QUEUED → RUNNING → RETRY_WAIT → COMPLETED|UNDETERMINED|FAILED` |

Observation state: `PENDING`, `NOT_FOUND`, `RPC_ERROR`, and `RPC_TIMEOUT` are retryable/undetermined; they are not failures. `REVERTED` is a chain execution failure. Re-observing a transaction compares the latest stored observation; a changed confirmed `blockHash` is `REORGED` and produces a new receipt. A receipt is `COMPLETED` only when confirmed and action/chain/participants/asset/amount/nonce/block-time/finality constraints bind. Insufficient finality is `UNDETERMINED`.

`Intent.validUntil` applies to `execution.executedAt`, which is the containing block timestamp. It is not a receipt expiration date. Verification evaluates the receipt signature and the issuer key's validity at `issuedAt`, so retained receipts remain verifiable after the intent window closes.
