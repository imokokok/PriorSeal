# ADR 012: Cloudflare D1 production persistence

**Context:** PriorSeal already runs its production API and console on Cloudflare Workers. Keeping the authoritative database outside Cloudflare added a network dependency, separate credentials, and a rollback path that could diverge from newly accepted evidence.

**Decision:** use the Worker's `DB` binding to make Cloudflare D1 the sole production persistence backend. Keep forward-only D1 migrations in `d1/migrations/`, use D1 for authorization and Merkle-log state, durable observation jobs, receipts, idempotency records, witness attestations, and the scoped evidence archive, and use verified D1 exports plus Time Travel for data recovery. Retain the PostgreSQL adapter only as a provider-neutral local Node development option.

**Alternatives:** continue using an external PostgreSQL service through Hyperdrive; split state between D1 and PostgreSQL; or move coordinated state into Durable Objects.

**Consequences:** production no longer needs PostgreSQL connection secrets or a second database control plane. D1 bindings, migrations, SQLite semantics, exports, Time Travel, Queues, and Worker releases must be validated together. A Worker code rollback is safe only while its schema contract remains compatible; data recovery must be tested in isolation before changing the active binding.

**Revisit triggers:** D1 limits or query semantics block a required workload, multi-region consistency requirements change, or a future service needs database features that cannot be implemented safely on D1.
