# ADR 008: Observability

**Context:** sensitive evidence service needs useful but safe diagnostics.

**Decision:** structured event injection points, health endpoints, and metric hooks without a telemetry vendor dependency. Protected service routes emit aggregateable success and outcome events containing only the route, request ID, and outcome code, so an operator can measure a pilot without browser tracking or wallet/transaction-content logging.

**Alternatives:** mandatory SaaS SDK.

**Consequences:** deployment supplies exporter/logger; secrets and request bodies are excluded.

**Revisit triggers:** SLOs or tracing correlation needed across services.
