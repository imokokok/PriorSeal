# ADR 005: Database-backed observation jobs
**Context:** in-memory jobs lose work on restart. **Decision:** use PostgreSQL rows, `SKIP LOCKED`, retries and idempotent writes. **Alternatives:** Redis/SQS/Kafka. **Consequences:** at-least-once processing and operationally simple deployment. **Revisit triggers:** queue throughput/latency or multi-region requirements exceed PostgreSQL safely.
