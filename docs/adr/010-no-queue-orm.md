# ADR 010: No Redis, queue, or ORM yet
**Status:** Superseded in part by ADR 011 for production delivery; PostgreSQL remains the source of truth and no ORM or Redis was introduced.

**Context:** current scale is small and dependency-free protocol portability matters. **Decision:** use direct PostgreSQL and no external queue/ORM. **Alternatives:** Redis, managed queues, ORM. **Consequences:** SQL/worker discipline is required but operational load stays low. **Revisit triggers:** measured throughput, scheduling, or query-composition pain.
