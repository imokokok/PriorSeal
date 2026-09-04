# Database operations

Apply SQL files in lexical order inside a transaction using a least-privileged migration role. Migrations are forward-only; do not edit an applied file. `002_runtime_state.sql` adds canonical intent JSON, immutable observation hashes, idempotency records and worker jobs.

Back up with point-in-time recovery enabled and test a restore at least quarterly. Restore to an isolated database, apply remaining forward migrations, verify receipt JSON hashes/signatures against the published key registry, then switch traffic only after readiness succeeds. Retain observations and receipts according to audit policy; expiry cleanup applies only to idempotency records after their TTL.

Workers claim rows with `FOR UPDATE SKIP LOCKED`, so the delivery contract is at-least-once. Consumers must keep receipt/observation writes idempotent. Investigate `FAILED` jobs, correct the cause, then explicitly requeue with a new idempotency key or audited state transition.
