# RunProof

RunProof creates portable evidence about an agent's observed EVM execution:

```text
Intent → canonical intent hash → EVM observation → binding result → Ed25519 receipt → offline verification
```

It does not custody assets, operate wallets, or hold transaction-signing keys. A valid receipt proves only that its issuer signed the included claims; it is not an economic-safety guarantee or proof that an RPC source is infallible. Local, independent receipt verification is authoritative; the HTTP verification endpoint is a convenience.

## Quick start

Requires Node 20+. In a clean checkout:

```bash
npm --prefix web ci
cp .env.example .env
# Set development-only RUNPROOF_* key-file paths and a configured RPC endpoint in .env.
npm run start:api
npm --prefix web run dev
```

The console is served by Vite on its displayed URL and proxies API calls to port 3000. It stores browser-local session activity only; it is not a server-side evidence archive. Amounts are atomic unsigned integer strings (never floats), such as `"1000000"`.

To run the receipt example (which creates ignored temporary key artifacts):

```bash
npm run example:receipt
npm run verify:receipt
```

## Quality checks

```bash
npm run check          # JS syntax lint, diff format check, web typecheck, tests, web build
npm run test:coverage
npm --prefix web audit --omit=dev
```

The API contract is at `/openapi/v1.json`. Operational endpoints are `/health/live`, `/health/ready`, and `/v1/version`.

## API and security boundaries

`POST /v1/intents`, `POST /v1/executions/observe`, `GET /v1/receipts/:receiptId`, `POST /v1/receipts/verify`, and `GET /.well-known/runproof-keys.json` are the stable v1 surface. Use an `Idempotency-Key` for writes. The same key and request body replay a result for 24 hours; a different body produces `IDEMPOTENCY_CONFLICT`.

Startup configuration is validated before the HTTP server listens: `PORT` must be 1–65535, `RUNPROOF_TRUST_PROXY` must be `true` or `false`, CORS entries must be complete HTTP(S) origins, and issuer key paths must be configured as a pair.

Only configured RPC endpoints are used (`RUNPROOF_RPC_ETHEREUM`, `RUNPROOF_RPC_BASE`, `RUNPROOF_RPC_ARBITRUM`). RPC timeouts, not-found states, and inconsistent/invalid responses are not treated as on-chain failure or success. Confirmed observations include finality; a changed block hash is evidence of reorganization and creates new evidence rather than overwriting old signed receipts.

Issuer private keys are read only from a configured local file for development and must never enter HTTP requests, logs, the frontend bundle, database records, or Git. Production deployments should replace that provider with a KMS/HSM/secret-manager adapter. See [the threat model](docs/security/threat-model.md), [API compatibility](docs/api/compatibility.md), and [lifecycle](docs/architecture/lifecycle.md).

## Persistence and operations

`migrations/001_init.sql` establishes evidence tables; `migrations/002_runtime_state.sql` adds durable intents, observation versions, idempotency records, and at-least-once worker jobs. Migrations are forward-only. Read [database operations](docs/runbooks/database.md) before applying them.

For a local container environment:

```bash
docker compose up --build
```

Mount issuer key files read-only outside the image and inject production configuration through the deployment secret system. Do not use the compose database password outside local development. See [operations](docs/runbooks/operations.md) for RPC outage, reorg, backup/restore, and key-rotation procedures.

## Architecture

RunProof is a modular monolith with explicit dependency direction: `domain` contains pure protocol rules, `application` coordinates use cases, `infrastructure` implements persistence/blockchain/key adapters, `interfaces` exposes HTTP, and `bootstrap` wires runtime configuration. `src/index.mjs` is the stable local library surface; callers should not import internal paths. This intentionally avoids premature microservices, queues, ORM, and cloud lock-in. The Phase 0 audit, risk matrix, and target architecture are in [docs/architecture/phase-0-audit.md](docs/architecture/phase-0-audit.md). Design decisions are recorded under [docs/adr](docs/adr).

## License

MIT
