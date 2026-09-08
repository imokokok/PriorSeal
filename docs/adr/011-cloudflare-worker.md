# ADR 011: Cloudflare Worker production adapter

**Context:** the container host sleeps on the free tier, while PriorSeal needs an always-addressable API, static console delivery, recoverable observation processing, and the existing Neon database without adding a paid server.

**Decision:** deploy the modular monolith as one Cloudflare Worker and attach the apex and `www` hostnames as Worker Custom Domains because the Worker is the application origin. Serve the Vite build with Workers Static Assets, connect to Neon through Hyperdrive, use Cloudflare Queues to prompt observation processing, and run a one-minute scheduled recovery scan. PostgreSQL remains authoritative for job ownership, attempts, idempotency, terminal results, and receipts; queue messages are at-least-once delivery hints and may be replayed safely. Each nonterminal delivery schedules a fresh delayed message before acknowledging the current message, so an early delivery cannot discard future work or exhaust one message's retry counter. Runtime configuration accepts Worker Secrets and bindings while retaining the Node bootstrap for local development.

**Alternatives:** keep the Render container and tolerate sleep; bind a payment method to another container platform; move protocol state into Durable Objects or D1; or use queue state as the source of truth.

**Consequences:** production no longer depends on a continuously running container, but it gains Cloudflare bindings and execution limits. Hyperdrive, Queue, cron, routes, and secrets must be release-checked together. Cold runtimes check migration 007 before serving production traffic. The Node bootstrap, `Dockerfile`, and `docker-compose.yml` remain a supported local-development path only; they are provider-neutral and are not part of the Cloudflare production deployment.

**Revisit triggers:** Worker CPU or request limits constrain cryptographic verification, Hyperdrive latency is unacceptable, queue volume needs independent scaling, a KMS/HSM integration requires a different runtime, or a paid always-on container becomes operationally preferable.
