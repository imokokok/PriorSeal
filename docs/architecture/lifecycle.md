# Lifecycle and state model

| Entity | Immutable fields | Mutable/lifecycle fields |
| --- | --- | --- |
| Intent | canonical fields and `intentHash` | none; create a new intent to change authorization |
| Observation | each observation record | later observations append a new version; never overwrite prior evidence |
| Binding | all result fields | recomputed only for a new receipt/observation |
| Receipt | entire signed payload | never mutate; a reorg is a new receipt with `REORGED` outcome |
| Key | public identity/key material | registry status and validity window; never change key material under a key ID |
| Job | input and idempotency key | `QUEUED → RUNNING → RETRY_WAIT → COMPLETED|UNDETERMINED|FAILED` |

Observation state: `PENDING`, `NOT_FOUND`, `RPC_ERROR`, and `RPC_TIMEOUT` are retryable/undetermined; they are not failures. `REVERTED` is a chain execution failure. A changed confirmed `blockHash` is `REORGED`. A receipt is `COMPLETED` only when confirmed and binding succeeds; insufficient finality is `UNDETERMINED`.
