# RunProof

## Web console

The production-style React console lives in the web directory. It includes a public explanation page plus the local evidence console for creating intents, observing execution, reviewing locally saved receipts, verifying receipts, and inspecting the published public key registry.

Start the existing API on port 3000:

    node -e "import('./src/api/server.mjs').then(({createApiServer}) => createApiServer().listen(3000))"

In another terminal, install and start the web console:

    cd web
    npm install
    npm run dev

Vite proxies API requests to localhost port 3000 during local development. For a separately hosted API, copy web/.env.example to web/.env.local and set VITE_API_BASE_URL to that API origin.

    cd web
    npm run build

The console stores intents, observations, and receipts created by the current browser in localStorage under runproof.local-session.v1. Its Receipts view is explicitly local session activity, not a server-side historical record. Amounts are sent and displayed as strings to preserve the API exact precision semantics.

RunProof is a small, open execution-proof layer for crypto agents. The implementation is dependency-free and uses Node.js 20's HTTP, fetch, and Ed25519 primitives; this keeps the offline verifier portable and avoids coupling the core domain to a web framework.

It binds a pre-authorized intent to an observed on-chain execution and produces a signed receipt that anyone can verify locally. The first demo is intentionally dependency-free: it uses Node.js built-in Ed25519 support and a canonical JSON representation.

## What the demo proves

The demo creates an intent for a token transfer, simulates the observed settlement, and signs a receipt containing:

- the intent hash;
- the execution transaction hash;
- chain and asset identifiers;
- sender, recipient, and amount;
- the outcome (`COMPLETED`, `FAILED`, or `UNDETERMINED`);
- the receipt issuer and signature.

The verifier checks the receipt offline. It does not call RunProof, an RPC endpoint, or a database.

This is a cryptographic integrity demo, not an endorsement of the underlying transaction. A valid signature proves that the stated issuer signed the stated bytes; it does not prove that the issuer's observations were economically correct.

## Run it

Requires Node.js 20 or newer.

```bash
npm run demo
npm run verify
```

The demo writes temporary key and receipt files under `demo/`. They are ignored by git.

## Core modules

The domain is split into `src/core` (intent, execution observation, outcomes, receipts, verifier), `src/adapters/evm` (deterministic JSON-RPC observation), `src/storage` (in-memory adapter), and `src/api` (minimal Node HTTP API). The older `src/receipt.mjs` remains a compatibility facade.

The EVM observer supports Ethereum (1), Base (8453), and Arbitrum (42161), and only uses explicitly configured environment variables: `RUNPROOF_RPC_ETHEREUM`, `RUNPROOF_RPC_BASE`, and `RUNPROOF_RPC_ARBITRUM`. Comma-separated values provide RPC fallback. It never guesses an endpoint.

## Tests and API

```bash
npm test
node -e "import('./src/api/server.mjs').then(({createApiServer}) => createApiServer().listen(8787))"
```

The API exposes `POST /v1/intents`, `POST /v1/executions/observe`, `GET /v1/receipts/:receiptId`, `POST /v1/receipts/verify`, and `GET /.well-known/runproof-keys.json`. Verification over HTTP is explicitly a convenience; the signed receipt and local verifier remain authoritative. The SQL migration in `migrations/001_init.sql` is PostgreSQL-compatible for a future Neon adapter, while the current API uses the storage interface and in-memory implementation.

Phase 2 adds `src/storage/postgres.mjs`, a parameterized PostgreSQL adapter around an injected `pg`-compatible pool. Deployments can install/configure `pg` with `DATABASE_URL`; local verification remains database-free. `src/core/keys.mjs` provides public-key registry and rotation metadata while excluding private key material from discovery responses. The API enforces request size/rate limits, request IDs, structured errors, and request timeouts.

## Phase 3 observation worker

`src/worker/observation-worker.mjs` provides an asynchronous, idempotent job runner. It retries pending/not-found/RPC observations with bounded exponential backoff, stops after a configurable attempt limit, and supports periodic polling through `start()`. Re-observations with a changed block hash are marked `REORGED`; the worker never converts RPC uncertainty into transaction failure.

## Phase 4 policy-aware binding

`src/core/binding.mjs` is the single Intent/Execution binding point. It returns stable reason codes for chain, participant, asset, amount, nonce, finality, gas, time-window, unavailable, and ambiguous-transfer mismatches. Intent constraints currently support `minConfirmations` and `maxGasUsed`. Receipts embed both the binding result and reason codes, so downstream treasury policy and reputation systems can consume explainable evidence without reimplementing matching logic.

## Phase 5 treasury policy

`src/policy/engine.mjs` evaluates an Intent before persistence or execution. Policies can allowlist chains, actions, assets, senders, and recipients, cap amounts, and limit the validity window. Rejections return stable reason codes and are deterministic; the engine has no price oracle, signing authority, or private-key access.


## Flow

```text
Intent → Intent hash → Observed execution → Signed receipt → Offline verification
```

## Project direction

The next adapters will replace the simulated settlement with real chain observers and add intent/execution binding for swaps, bridges, treasury transfers, and agent-managed DeFi operations.

## License

MIT
