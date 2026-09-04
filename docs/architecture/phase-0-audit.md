# Phase 0 audit — 2026-09-04

## Baseline architecture

```text
React console → HTTP interface → application use cases → domain protocol
                                              ↓                 ↑
                                  persistence / EVM / key adapters
Background worker ────────────→ observation use case → receipt signer → verifier
```

Baseline tests passed (10 Node tests). The repository contained no tracked PEM/private-key files; generated example artifacts are ignored. This is not proof that a credential was never exposed outside reachable Git history or outside this checkout.

## Risk matrix and disposition

| Priority | Finding | Disposition |
| --- | --- | --- |
| P0 | API accepted arbitrary fields and matched full URL including query strings | fixed: pathname routing, bounded/safe JSON and allowlists |
| P0 | Worker jobs disappeared on restart | fixed interface and PostgreSQL-backed job schema/claim implementation; production wiring requires pool composition |
| P1 | Receipt ID could collide across re-observations of the same transaction | fixed: evidence hash participates in ID; old receipts remain immutable |
| P1 | RPC trusted response shape and chain identity | fixed: endpoint chain check, envelope checks, retries, timeout, safer log parsing |
| P1 | Postgres observation persistence was a stub | fixed: immutable observation versions and retrieval |
| P1 | No OpenAPI, health endpoints, CI, or runbooks | fixed |
| P2 | Browser session storage had no migration/validation/export | fixed v1→v2 best-effort migration, validation, export/clear |
| P2 | Metrics/tracing exporter and full browser E2E harness | intentionally deferred; ports and event fields remain to be connected by deployment owner |

## Target architecture

```text
interfaces/http                 bootstrap
          ↓                         ↓
application use cases ← dependency composition
          ↓
domain protocol, values, and policy
          ↑                 ↑
persistence adapters    EVM RPC adapter / key provider
```

The project stays a modular monolith. Protocol code has no HTTP, database, environment, or fetch dependency.

## Delivery phases

1. Quality/configuration and public documentation.
2. Protocol values, canonical JSON hardening, golden vectors, receipt identity.
3. HTTP composition, validation, idempotency and OpenAPI.
4. Persistent storage/job schema and claiming.
5. RPC response/finality hardening.
6. Key/threat-model documentation and CI scanning.
7. Console storage resilience and contract-aligned behaviour.
8. Docker, health checks, CI and runbooks.

Compatibility: receipt schema/domain/canonical serialization are retained. Intent construction now rejects malformed addresses, assets and non-integer atomic amounts; clients must send atomic integer strings. Existing v1 receipt IDs remain verifiable, while newly issued IDs include the execution hash.
